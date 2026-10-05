-- Transaction-local fixtures exercise a copy of the stored job command.
-- Replace only the Vault relation and HTTP call with pg_temp capture fixtures.
-- No actual credential, HTTP request, scheduler tick or Vault mutation is used.
begin;
select plan(27);

create temporary table scheduler_config(name text primary key, decrypted_secret text);
create temporary table scheduler_requests(
  id bigint generated always as identity,
  url text, params jsonb, headers jsonb, timeout_milliseconds integer
);
create function pg_temp.capture_scheduler_request(
  url text, params jsonb, headers jsonb, timeout_milliseconds integer
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into pg_temp.scheduler_requests(url,params,headers,timeout_milliseconds)
  values ($1,$2,$3,$4) returning id into v_id;
  return v_id;
end;
$$;
create function pg_temp.run_scheduler_command() returns void language plpgsql as $$
declare v_command text;
begin
  select command into strict v_command from cron.job
  where jobname='entry_personal_projection_outbox_drain';
  v_command := replace(v_command,'vault.decrypted_secrets','pg_temp.scheduler_config');
  v_command := replace(v_command,'net.http_get','pg_temp.capture_scheduler_request');
  execute v_command;
end;
$$;

select is((select count(*) from cron.job where jobname='entry_personal_projection_outbox_drain'),1::bigint,
  'Exactly the existing named job is present');
select is((select schedule from cron.job where jobname='entry_personal_projection_outbox_drain'),'*/5 * * * *',
  'The five-minute schedule is retained');
select ok((select active from cron.job where jobname='entry_personal_projection_outbox_drain'),
  'The existing active setting is retained');
select ok((select position('entry_projection_drain_url' in command)>0 from cron.job where jobname='entry_personal_projection_outbox_drain'),
  'The current command reads the environment endpoint from Vault');
select ok((select position('https://entry.leademergence.com' in command)=0 from cron.job where jobname='entry_personal_projection_outbox_drain'),
  'The current command has no hard-coded production target');

insert into scheduler_config values
  ('entry_projection_drain_url','https://entry.fixture.example/api/internal/cron/personal-projection-drain'),
  ('cron_secret','fixture-token-one');
select lives_ok($$select pg_temp.run_scheduler_command()$$,'A configured endpoint runs the captured command');
select results_eq(
  $$select url,params,headers,timeout_milliseconds from pg_temp.scheduler_requests$$,
  $$values ('https://entry.fixture.example/api/internal/cron/personal-projection-drain'::text,'{}'::jsonb,'{"Authorization":"Bearer fixture-token-one"}'::jsonb,10000)$$,
  'Exactly the configured endpoint, credential, empty params and timeout reach the capture');

truncate scheduler_requests;
update scheduler_config set decrypted_secret='http://127.0.0.1:3300/api/internal/cron/personal-projection-drain'
where name='entry_projection_drain_url';
select lives_ok($$select pg_temp.run_scheduler_command()$$,'An explicitly configured local HTTP endpoint is supported');
select is((select url from scheduler_requests),'http://127.0.0.1:3300/api/internal/cron/personal-projection-drain',
  'Local configuration does not fall back to production');

truncate scheduler_requests;
update scheduler_config set decrypted_secret=' https://changed.fixture.example/api/internal/cron/personal-projection-drain '
where name='entry_projection_drain_url';
update scheduler_config set decrypted_secret='fixture-token-two' where name='cron_secret';
select lives_ok($$select pg_temp.run_scheduler_command()$$,'Changed configuration is read on the next invocation');
select results_eq(
  $$select url,headers from pg_temp.scheduler_requests$$,
  $$values ('https://changed.fixture.example/api/internal/cron/personal-projection-drain'::text,'{"Authorization":"Bearer fixture-token-two"}'::jsonb)$$,
  'Endpoint whitespace is trimmed and the current credential is used');

truncate scheduler_requests;
delete from scheduler_config where name='entry_projection_drain_url';
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain endpoint is missing or has an unsupported format.','Missing endpoint fails visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Missing endpoint makes no HTTP call');

insert into scheduler_config values ('entry_projection_drain_url','   ');
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain endpoint is missing or has an unsupported format.','Blank endpoint fails visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Blank endpoint makes no HTTP call');

update scheduler_config set decrypted_secret='ftp://entry.fixture.example/api/internal/cron/personal-projection-drain'
where name='entry_projection_drain_url';
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain endpoint is missing or has an unsupported format.','Unsupported endpoint scheme fails visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Unsupported scheme makes no HTTP call');

update scheduler_config set decrypted_secret='https://entry.fixture.example/api/billing/checkout'
where name='entry_projection_drain_url';
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain endpoint is missing or has an unsupported format.','An unrelated route fails visibly');
select is((select count(*) from scheduler_requests),0::bigint,'An unrelated route makes no HTTP call');

update scheduler_config set decrypted_secret='https://fixture:password@entry.fixture.example/api/internal/cron/personal-projection-drain'
where name='entry_projection_drain_url';
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain endpoint is missing or has an unsupported format.','Embedded URL credentials fail visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Embedded URL credentials make no HTTP call');

update scheduler_config set decrypted_secret='https://entry.fixture.example/api/internal/cron/personal-projection-drain?job=other'
where name='entry_projection_drain_url';
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain endpoint is missing or has an unsupported format.','Endpoint query selectors fail visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Endpoint query selectors make no HTTP call');

update scheduler_config set decrypted_secret='https://entry.fixture.example/api/internal/cron/personal-projection-drain'
where name='entry_projection_drain_url';
delete from scheduler_config where name='cron_secret';
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain credential is not configured.','Missing credential fails visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Missing credential makes no HTTP call');

insert into scheduler_config values ('cron_secret','   ');
select throws_ok($$select pg_temp.run_scheduler_command()$$,'22023',
  'Projection drain credential is not configured.','Blank credential fails visibly');
select is((select count(*) from scheduler_requests),0::bigint,'Blank credential makes no HTTP call');

select * from finish();
rollback;
