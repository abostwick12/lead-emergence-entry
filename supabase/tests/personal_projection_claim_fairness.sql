begin;
select plan(34);

-- Synthetic identities and rows; the fixture rolls back.
select is((select count(*) from entry_identity.personal_projection_outbox), 0::bigint,
  'The isolated claim fixture begins with an empty outbox');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-00000000fa' || lpad(i::text,2,'0'))::uuid,
  'authenticated','authenticated','claim-fair-' || i || '@example.invalid',now(),'{}',now(),now()
from generate_series(1,11) as i;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-4000-8000-00000000fb01','authenticated','authenticated','claim-failed@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000fb02','authenticated','authenticated','claim-leased@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000fc01','authenticated','authenticated','claim-authority@example.invalid',now(),'{}',now(),now());

-- Ten distinct users fail. A healthy eleventh user must advance after their
-- next attempt, without any failed delivery being silently discarded.
insert into entry_identity.personal_projection_outbox (
  canonical_user_id,projection_kind,projection_data,created_at,
  attempts,last_attempt_at,last_error
)
select ('00000000-0000-4000-8000-00000000fa' || lpad(position::text,2,'0'))::uuid,
  'BILLING',jsonb_build_object('fixture_position',position),
  case when position <= 10 then now() - interval '20 minutes' else now() - interval '1 minute' end,
  case when position <= 10 then 1 else 0 end,
  case when position <= 10 then now() - interval '10 minutes' else null end,
  case when position <= 10 then 'WORKSPACE_TRANSPORT_UNAVAILABLE' else null end
from generate_series(1,11) as fixture(position)
order by position;

set local role service_role;
create temporary table fairness_failed_batch as
select * from public.claim_entry_personal_projection_batch(10);
reset role;
select is((select count(*) from fairness_failed_batch),10::bigint,
  'The first batch claims ten failing users');
select is((select count(distinct canonical_user_id) from fairness_failed_batch),10::bigint,
  'The first batch contains one oldest pending delivery per user');
select is((select count(*) from fairness_failed_batch where projection_data->>'fixture_position' = '11'),0::bigint,
  'The healthy eleventh user is outside the ten-row batch');

set local role service_role;
select ok((select bool_and(public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
)) from fairness_failed_batch),
  'All ten failed results retain their pending delivery IDs');
create temporary table fairness_healthy_claim as
select * from public.claim_entry_personal_projection_batch(1);
reset role;
select results_eq(
  $$select canonical_user_id from fairness_healthy_claim$$,
  $$values ('00000000-0000-4000-8000-00000000fa11'::uuid)$$,
  'The healthy eleventh user progresses after ten failures');

set local role service_role;
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,true,null
) from fairness_healthy_claim),
  'The healthy delivery completes');
create temporary table fairness_retry as
select * from public.claim_entry_personal_projection_batch(1);
reset role;
select results_eq(
  $$select delivery_id from fairness_retry$$,
  $$select delivery_id from fairness_failed_batch order by projection_version limit 1$$,
  'A failed user retries with the same delivery ID');
select results_eq(
  $$select attempts from fairness_retry$$,
  $$values (3)$$,
  'A retry increments the fenced attempt');
set local role service_role;
select is((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts - 1,true,null
) from fairness_retry),false,
  'A stale worker cannot acknowledge a newer claim');
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
) from fairness_retry),
  'The retried failure remains explicitly retryable');
create temporary table fairness_next_retry as
select * from public.claim_entry_personal_projection_batch(1);
reset role;
select results_eq(
  $$select delivery_id from fairness_next_retry$$,
  $$select delivery_id from fairness_failed_batch order by projection_version offset 1 limit 1$$,
  'A different failing user gets the next fair retry');
select is((select count(*) from entry_identity.personal_projection_outbox
  where canonical_user_id in (
    select ('00000000-0000-4000-8000-00000000fa' || lpad(i::text,2,'0'))::uuid
    from generate_series(1,10) as i
  ) and delivery_state = 'PENDING'),10::bigint,
  'Failures remain pending rather than being discarded');

delete from entry_identity.personal_projection_outbox;

-- A failed predecessor blocks a later version from the same user.
insert into entry_identity.personal_projection_outbox (
  canonical_user_id,projection_kind,projection_data,created_at,
  attempts,last_attempt_at,last_error
) values
  ('00000000-0000-4000-8000-00000000fb01','BILLING','{"step":1}',now() - interval '20 minutes',
   1,now() - interval '10 minutes','WORKSPACE_TRANSPORT_UNAVAILABLE'),
  ('00000000-0000-4000-8000-00000000fb01','BILLING','{"step":2}',now() - interval '1 minute',
   0,null,null);
set local role service_role;
create temporary table failed_first as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select (projection_data->>'step')::integer from failed_first$$,
  $$values (1)$$,
  'Only the failed predecessor is claimed for its user');
set local role service_role;
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
) from failed_first), 'The predecessor can fail again');
create temporary table failed_retry as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select delivery_id from failed_retry$$,
  $$select delivery_id from failed_first$$,
  'The later same-user version cannot overtake a failed predecessor');
set local role service_role;
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,true,null
) from failed_retry), 'The predecessor can recover');
create temporary table failed_successor as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select (projection_data->>'step')::integer from failed_successor$$,
  $$values (2)$$,
  'The successor becomes claimable after predecessor delivery');

delete from entry_identity.personal_projection_outbox;

-- A five-minute lease also blocks the successor, even though the successor is
-- otherwise eligible and has an earlier fairness timestamp.
insert into entry_identity.personal_projection_outbox (
  canonical_user_id,projection_kind,projection_data,created_at,
  attempts,last_attempt_at,last_error
) values
  ('00000000-0000-4000-8000-00000000fb02','BILLING','{"step":1}',now() - interval '20 minutes',
   1,now(),null),
  ('00000000-0000-4000-8000-00000000fb02','BILLING','{"step":2}',now() - interval '1 minute',
   0,null,null);
set local role service_role;
create temporary table leased_empty as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select is((select count(*) from leased_empty),0::bigint,
  'A leased predecessor holds its later version');
update entry_identity.personal_projection_outbox
set last_attempt_at=now() - interval '6 minutes'
where canonical_user_id='00000000-0000-4000-8000-00000000fb02'
  and projection_data->>'step'='1';
set local role service_role;
create temporary table leased_first as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select (projection_data->>'step')::integer from leased_first$$,
  $$values (1)$$,
  'An expired predecessor lease can be reclaimed after five minutes');
set local role service_role;
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,true,null
) from leased_first), 'The reclaimed predecessor can complete');
create temporary table leased_successor as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select (projection_data->>'step')::integer from leased_successor$$,
  $$values (2)$$,
  'The leased successor advances only after predecessor delivery');

delete from entry_identity.personal_projection_outbox;

-- Exercise the actual authority transition trigger: old-key revocation must
-- be delivered before the new key can become active in Workspace.
insert into entry_identity.product_entitlements(canonical_user_id,product,status,source,authority_kind)
values ('00000000-0000-4000-8000-00000000fc01','PERSONAL','ACTIVE','operator_seed','INTERNAL_OPERATOR');
select results_eq(
  $$select projection_data->>'entitlement_status' from entry_identity.personal_projection_outbox
    where canonical_user_id='00000000-0000-4000-8000-00000000fc01'$$,
  $$values ('ACTIVE'::text)$$,
  'The existing trigger emits the initial active authority');
set local role service_role;
create temporary table initial_authority as select * from public.claim_entry_personal_projection_batch(1);
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,true,null
) from initial_authority), 'The initial authority completes');
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-00000000fc01','PERSONAL','ACTIVE','family_comp_2026',null
  )$$, 'The supported command replaces internal with sponsored authority');
reset role;
select results_eq(
  $$select (projection_data->>'entitlement_status') || ':' || (projection_data->>'authority_kind')
    from entry_identity.personal_projection_outbox
    where canonical_user_id='00000000-0000-4000-8000-00000000fc01'
    order by projection_version offset 1$$,
  $$values ('REVOKED:INTERNAL_OPERATOR'::text),('ACTIVE:SPONSORED_ACCESS'::text)$$,
  'The trigger enqueues old-key revocation before new-key activation');
set local role service_role;
create temporary table authority_revoke as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select projection_data->>'entitlement_status' from authority_revoke$$,
  $$values ('REVOKED'::text)$$,
  'Only the old-key revocation is claimable first');
set local role service_role;
create temporary table authority_leased_empty as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select is((select count(*) from authority_leased_empty),0::bigint,
  'The leased revocation blocks activation');
set local role service_role;
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
) from authority_revoke), 'A failed revocation stays retryable');
create temporary table authority_revoke_retry as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select delivery_id from authority_revoke_retry$$,
  $$select delivery_id from authority_revoke$$,
  'The failed revocation retains its delivery ID');
set local role service_role;
select is((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts - 1,true,null
) from authority_revoke_retry),false,
  'A stale revocation worker cannot acknowledge the newer attempt');
select ok((select public.mark_entry_personal_projection_delivery(
  delivery_id,attempts,true,null
) from authority_revoke_retry), 'The revocation recovers and completes');
create temporary table authority_activate as select * from public.claim_entry_personal_projection_batch(10);
reset role;
select results_eq(
  $$select (projection_data->>'entitlement_status') || ':' || (projection_data->>'authority_kind')
    from authority_activate$$,
  $$values ('ACTIVE:SPONSORED_ACCESS'::text)$$,
  'New authority activates only after old-key revocation is delivered');
select ok(
  not has_function_privilege('anon','public.claim_entry_personal_projection_batch(integer)','execute')
  and not has_function_privilege('authenticated','public.claim_entry_personal_projection_batch(integer)','execute'),
  'Anonymous and authenticated callers remain unable to claim deliveries');

select * from finish();
rollback;
