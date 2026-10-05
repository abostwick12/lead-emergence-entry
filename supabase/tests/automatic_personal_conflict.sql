begin;
select plan(16);

select ok(has_function_privilege('service_role',
  'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)', 'EXECUTE'),
  'The existing trusted setter remains available');
select ok(not has_function_privilege('authenticated',
  'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)', 'EXECUTE'),
  'Authenticated callers still cannot self-grant');
select ok(not has_function_privilege('anon',
  'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)', 'EXECUTE'),
  'Anonymous callers still cannot self-grant');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-00000000f301','authenticated','authenticated','automatic-new@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000f302','authenticated','authenticated','automatic-pending@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000f303','authenticated','authenticated','automatic-suspended@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000f304','authenticated','authenticated','automatic-revoked@example.invalid',now(),'{}',now(),now());

-- First simulate the helper's absent read. The explicit rows arrive before
-- its subsequent setter call, reproducing the stale-read ordering.
set local role service_role;
select ok(
  public.get_entry_product_entitlement_status('00000000-0000-4000-8000-00000000f302','PERSONAL') is null
  and public.get_entry_product_entitlement_status('00000000-0000-4000-8000-00000000f303','PERSONAL') is null
  and public.get_entry_product_entitlement_status('00000000-0000-4000-8000-00000000f304','PERSONAL') is null,
  'The initial reads see no entitlement');
reset role;

insert into entry_identity.product_entitlements(
  canonical_user_id,product,status,source,authority_kind,granted_at,revoked_at,updated_at
) values
  ('00000000-0000-4000-8000-00000000f302','PERSONAL','PENDING','sotf_founding_fellow_2026','OFFER_ELIGIBILITY',null,null,'2026-09-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000f303','PERSONAL','SUSPENDED','family_comp_2026','SPONSORED_ACCESS','2026-08-01T00:00:00Z',null,'2026-09-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000f304','PERSONAL','REVOKED','family_comp_2026','SPONSORED_ACCESS','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');

set local role service_role;
select results_eq(
  $$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f302','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,
  array['PENDING'], 'Automatic provisioning preserves the pending explicit offer');
select results_eq(
  $$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f303','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,
  array['SUSPENDED'], 'Automatic provisioning preserves the concurrent suspension');
select results_eq(
  $$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f304','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,
  array['REVOKED'], 'Automatic provisioning preserves the concurrent revocation');
select results_eq(
  $$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f301','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,
  array['ACTIVE'], 'An absent entitlement still activates');
reset role;

select results_eq(
  $$select canonical_user_id,status::text,source,authority_kind::text,granted_at,revoked_at,updated_at
    from entry_identity.product_entitlements
    where canonical_user_id in ('00000000-0000-4000-8000-00000000f302','00000000-0000-4000-8000-00000000f303','00000000-0000-4000-8000-00000000f304')
      and product='PERSONAL' order by canonical_user_id$$,
  $$values
    ('00000000-0000-4000-8000-00000000f302'::uuid,'PENDING'::text,'sotf_founding_fellow_2026'::text,'OFFER_ELIGIBILITY'::text,null::timestamptz,null::timestamptz,'2026-09-01T00:00:00Z'::timestamptz),
    ('00000000-0000-4000-8000-00000000f303'::uuid,'SUSPENDED','family_comp_2026','SPONSORED_ACCESS','2026-08-01T00:00:00Z'::timestamptz,null::timestamptz,'2026-09-01T00:00:00Z'::timestamptz),
    ('00000000-0000-4000-8000-00000000f304'::uuid,'REVOKED','family_comp_2026','SPONSORED_ACCESS','2026-08-01T00:00:00Z'::timestamptz,'2026-09-01T00:00:00Z'::timestamptz,'2026-09-01T00:00:00Z'::timestamptz)$$,
  'Conflicting rows retain their status, authority, source and lifecycle timestamps');
select is((select count(*) from entry_identity.identity_audit_events
  where canonical_user_id in ('00000000-0000-4000-8000-00000000f302','00000000-0000-4000-8000-00000000f303','00000000-0000-4000-8000-00000000f304')
    and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'), 0::bigint,
  'No-op automatic calls do not claim an entitlement change in the audit trail');
select is((select count(*) from entry_identity.identity_audit_events
  where canonical_user_id='00000000-0000-4000-8000-00000000f301' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'), 1::bigint,
  'The inserted entitlement has exactly one audit event');

set local role service_role;
select results_eq(
  $$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f301','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,
  array['ACTIVE'], 'Repeated automatic provisioning returns the existing active status');
reset role;
select is((select count(*) from entry_identity.identity_audit_events
  where canonical_user_id='00000000-0000-4000-8000-00000000f301' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'), 1::bigint,
  'Repeated automatic provisioning adds no audit event');

set local role service_role;
select results_eq(
  $$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f304','PERSONAL','ACTIVE','family_comp_2026',null)$$,
  array['ACTIVE'], 'Explicit administration can still reactivate a revoked entitlement');
reset role;
select results_eq(
  $$select status::text,authority_kind::text,source from entry_identity.product_entitlements
    where canonical_user_id='00000000-0000-4000-8000-00000000f304' and product='PERSONAL'$$,
  $$values ('ACTIVE'::text,'SPONSORED_ACCESS'::text,'family_comp_2026'::text)$$,
  'Explicit administration retains the sponsored authority contract');
select is((select count(*) from entry_identity.identity_audit_events
  where canonical_user_id='00000000-0000-4000-8000-00000000f304' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'), 1::bigint,
  'Explicit administration still writes its audit event');

select * from finish();
rollback;
