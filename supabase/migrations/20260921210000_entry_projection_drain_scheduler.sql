create extension if not exists pg_cron;
create extension if not exists pg_net;

do $scheduler$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'entry_personal_projection_outbox_drain'
  ) then
    raise exception 'Cron job entry_personal_projection_outbox_drain already exists';
  end if;
end
$scheduler$;

select cron.schedule(
  'entry_personal_projection_outbox_drain',
  '*/5 * * * *',
  $cron$
  select net.http_get(
    url := 'https://entry.leademergence.com/api/internal/cron/personal-projection-drain',
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    timeout_milliseconds := 10000
  ) as request_id;
  $cron$
);
