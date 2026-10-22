begin;
select plan(10);

-- Disposable synthetic data only; this fixture requires the clean local chain.
select is(
  (select count(*) from entry_identity.personal_projection_outbox),
  0::bigint,
  'The isolated fairness fixture begins with an empty outbox'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values (
  '00000000-0000-4000-8000-00000000fa01','authenticated','authenticated',
  'projection-fairness@example.invalid',now(),'{}',now(),now()
);

insert into entry_identity.personal_projection_outbox (
  canonical_user_id,projection_kind,projection_data,created_at,
  attempts,last_attempt_at,last_error
)
select
  '00000000-0000-4000-8000-00000000fa01','BILLING',
  jsonb_build_object('fixture_position',position),
  case when position <= 10 then now() - interval '20 minutes'
       else now() - interval '1 minute' end,
  case when position <= 10 then 1 else 0 end,
  case when position <= 10 then now() - interval '10 minutes' else null end,
  case when position <= 10 then 'WORKSPACE_TRANSPORT_UNAVAILABLE' else null end
from generate_series(1,11) as fixture(position)
order by position;

set local role service_role;
create temporary table fairness_failed_batch as
select * from public.claim_entry_personal_projection_batch(10);
reset role;

select results_eq(
  $$select (projection_data->>'fixture_position')::integer
    from fairness_failed_batch order by projection_version$$,
  array[1,2,3,4,5,6,7,8,9,10],
  'The first batch claims all ten older failing deliveries'
);

set local role service_role;
select ok(
  (select bool_and(public.mark_entry_personal_projection_delivery(
    delivery_id,attempts,false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
  )) from fairness_failed_batch),
  'All ten old deliveries fail through the fenced result RPC'
);
create temporary table fairness_healthy_claim as
select * from public.claim_entry_personal_projection_batch(1);
reset role;

select results_eq(
  $$select delivery_id from fairness_healthy_claim$$,
  $$select delivery_id from entry_identity.personal_projection_outbox
    where projection_data->>'fixture_position' = '11'$$,
  'A newer healthy delivery gets the next one-row claim despite ten failures'
);

set local role service_role;
select ok(
  (select public.mark_entry_personal_projection_delivery(
    delivery_id,attempts,true,null
  ) from fairness_healthy_claim),
  'The healthy delivery can complete while the old deliveries remain pending'
);
create temporary table fairness_retry as
select * from public.claim_entry_personal_projection_batch(1);
reset role;

select results_eq(
  $$select delivery_id from fairness_retry$$,
  $$select delivery_id from fairness_failed_batch order by projection_version limit 1$$,
  'Tied failure timestamps and attempt counts retry the lowest version with its stable ID'
);
select results_eq(
  $$select attempts from fairness_retry$$,
  array[3],
  'A failed delivery remains recoverable and increments its claim attempt'
);

set local role service_role;
select ok(
  (select public.mark_entry_personal_projection_delivery(
    delivery_id,attempts,false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
  ) from fairness_retry),
  'The repeatedly failing old delivery remains explicitly retryable'
);
create temporary table fairness_next_retry as
select * from public.claim_entry_personal_projection_batch(1);
reset role;

select results_eq(
  $$select delivery_id from fairness_next_retry$$,
  $$select delivery_id from fairness_failed_batch order by projection_version offset 1 limit 1$$,
  'With timestamps tied, fewer attempts precede a repeatedly failing lower version'
);
select ok(
  not has_function_privilege('anon','public.claim_entry_personal_projection_batch(integer)','execute')
  and not has_function_privilege('authenticated','public.claim_entry_personal_projection_batch(integer)','execute'),
  'Anonymous and ordinary authenticated callers remain unable to claim deliveries'
);

select * from finish();
rollback;
