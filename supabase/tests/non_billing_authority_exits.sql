begin;
select plan(20);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-00000000f6' || lpad(i::text,2,'0'))::uuid,
  'authenticated','authenticated','projection-exit-' || i || '@example.invalid',now(),'{}',now(),now()
from generate_series(1,7) as i;

insert into entry_identity.product_entitlements(canonical_user_id,product,status,source,authority_kind)
values ('00000000-0000-4000-8000-00000000f601','PERSONAL','ACTIVE','operator_seed','INTERNAL_OPERATOR');
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601' order by projection_version$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"ACTIVE","source":"operator_seed"}'::jsonb)$$,
  'Initial internal authority publishes its existing normalized payload'
);

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f601','PERSONAL','PENDING','operator_pending',null)$$,
  'The audited operator command can move internal access to pending');
reset role;
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601' order by projection_version offset 1$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"REVOKED","source":"operator_pending"}'::jsonb)$$,
  'Leaving the projectable statuses publishes an explicit revocation for the old authority'
);
update entry_identity.product_entitlements set updated_at=now() where canonical_user_id='00000000-0000-4000-8000-00000000f601';
select is((select count(*) from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601'),2::bigint,
  'An unchanged pending row does not publish another projection');

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f601','PERSONAL','ACTIVE','operator_restore',null)$$,
  'The audited command can restore internal authority');
reset role;
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601' order by projection_version offset 2$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"ACTIVE","source":"operator_restore"}'::jsonb)$$,
  'Restored authority is published at a later version'
);
set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f601','PERSONAL','ACTIVE','family_comp_2026',null)$$,
  'The audited command can replace internal authority with sponsored access');
reset role;
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601' order by projection_version offset 3$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"REVOKED","source":"family_comp_2026"}'::jsonb),
           ('{"authority_kind":"SPONSORED_ACCESS","entitlement_status":"ACTIVE","source":"family_comp_2026"}'::jsonb)$$,
  'Replacing authority revokes the old key before publishing the new key'
);
set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f601','PERSONAL','SUSPENDED','family_comp_2026',null)$$,
  'Sponsored suspension remains supported');
reset role;
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601' order by projection_version offset 5$$,
  $$values ('{"authority_kind":"SPONSORED_ACCESS","entitlement_status":"SUSPENDED","source":"family_comp_2026"}'::jsonb)$$,
  'An ordinary lifecycle update publishes once without a redundant old-key revocation'
);
set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f601','PERSONAL','PENDING','sotf_founding_fellow_2026',null)$$,
  'The audited command can replace sponsored authority with pending offer eligibility');
reset role;
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601' order by projection_version offset 6$$,
  $$values ('{"authority_kind":"SPONSORED_ACCESS","entitlement_status":"REVOKED","source":"sotf_founding_fellow_2026"}'::jsonb)$$,
  'An offer replacement revokes the former sponsored key without publishing unsupported offer data'
);
set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f601','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,
  'Automatic provisioning still returns the existing explicit state');
reset role;
select is((select count(*) from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f601'),7::bigint,
  'Automatic no-op does not enqueue or reactivate prior authority');

insert into entry_identity.product_entitlements(canonical_user_id,product,status,source,authority_kind) values
  ('00000000-0000-4000-8000-00000000f602','PERSONAL','ACTIVE','historical_import',null),
  ('00000000-0000-4000-8000-00000000f603','PERSONAL','ACTIVE','legacy_import','LEGACY_PREBILLING'),
  ('00000000-0000-4000-8000-00000000f604','CONSULTING','ACTIVE','operator_seed','INTERNAL_OPERATOR'),
  ('00000000-0000-4000-8000-00000000f605','PERSONAL','PENDING','operator_seed','INTERNAL_OPERATOR');
select is((select count(*) from entry_identity.personal_projection_outbox where canonical_user_id in (
  '00000000-0000-4000-8000-00000000f602','00000000-0000-4000-8000-00000000f603',
  '00000000-0000-4000-8000-00000000f604','00000000-0000-4000-8000-00000000f605')),0::bigint,
  'NULL, legacy, other-product and pending inserts do not publish non-billing authority');

insert into entry_identity.product_entitlements(canonical_user_id,product,status,source,authority_kind) values
  ('00000000-0000-4000-8000-00000000f606','PERSONAL','ACTIVE','operator_seed','INTERNAL_OPERATOR'),
  ('00000000-0000-4000-8000-00000000f607','PERSONAL','ACTIVE','operator_seed','INTERNAL_OPERATOR');
update entry_identity.product_entitlements set authority_kind=null,source='clear_authority' where canonical_user_id='00000000-0000-4000-8000-00000000f606';
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f606' order by projection_version offset 1$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"REVOKED","source":"clear_authority"}'::jsonb)$$,
  'Clearing authority publishes a receiver-compatible old-key revocation, not NULL authority'
);
update entry_identity.product_entitlements set authority_kind='LEGACY_PREBILLING',source='legacy_transition' where canonical_user_id='00000000-0000-4000-8000-00000000f607';
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f607' order by projection_version offset 1$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"REVOKED","source":"legacy_transition"}'::jsonb)$$,
  'Moving to legacy authority publishes a receiver-compatible old-key revocation'
);
update entry_identity.product_entitlements set status='ACTIVE',source='operator_restore' where canonical_user_id='00000000-0000-4000-8000-00000000f605';
update entry_identity.product_entitlements set source='operator_relabel' where canonical_user_id='00000000-0000-4000-8000-00000000f605';
select results_eq(
  $$select projection_data from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f605' order by projection_version$$,
  $$values ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"ACTIVE","source":"operator_restore"}'::jsonb),
           ('{"authority_kind":"INTERNAL_OPERATOR","entitlement_status":"ACTIVE","source":"operator_relabel"}'::jsonb)$$,
  'Source-only changes retain the existing projection behavior'
);
update entry_identity.product_entitlements set updated_at=now() where canonical_user_id='00000000-0000-4000-8000-00000000f605';
select is((select count(*) from entry_identity.personal_projection_outbox where canonical_user_id='00000000-0000-4000-8000-00000000f605'),2::bigint,
  'Unchanged active authority does not enqueue duplicates');
select ok(not exists (
  select 1 from entry_identity.personal_projection_outbox where canonical_user_id in (
    select ('00000000-0000-4000-8000-00000000f6' || lpad(i::text,2,'0'))::uuid from generate_series(1,7) as i
  ) and (
    (projection_data->>'authority_kind') is null
    or projection_data->>'authority_kind' not in ('SPONSORED_ACCESS','INTERNAL_OPERATOR')
    or projection_data->>'entitlement_status' not in ('ACTIVE','SUSPENDED','REVOKED')
    or projection_data - array['authority_kind','entitlement_status','source'] <> '{}'::jsonb
  )
), 'Every emitted authority payload fits the existing receiver enum and key contract');

select * from finish();
rollback;
