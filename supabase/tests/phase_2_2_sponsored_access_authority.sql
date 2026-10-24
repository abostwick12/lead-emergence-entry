begin;
select plan(33);

select results_eq(
  $$select enumlabel::text collate "default"
    from pg_enum
    where enumtypid = 'entry_identity.entitlement_authority_kind'::regtype
    order by enumsortorder$$,
  array['BILLING','OFFER_ELIGIBILITY','INTERNAL_OPERATOR','LEGACY_PREBILLING','SPONSORED_ACCESS'],
  'Sponsored access is added without removing or reordering accepted authority kinds'
);
select ok(
  'SPONSORED_ACCESS'::entry_identity.entitlement_authority_kind
    <> 'INTERNAL_OPERATOR'::entry_identity.entitlement_authority_kind,
  'Sponsored access is structurally distinct from internal operator authority'
);
select ok(
  exists(
    select 1 from pg_constraint
    where conname = 'product_entitlements_sponsored_personal_lifecycle'
      and conrelid = 'entry_identity.product_entitlements'::regclass
  ),
  'The sponsored Personal lifecycle constraint exists'
);
select results_eq(
  $$select count(*) from entry_identity.product_entitlements
    where authority_kind = 'SPONSORED_ACCESS'$$,
  array[0::bigint],
  'The migration performs no sponsored-access backfill or identity grant'
);
select is(
  has_function_privilege(
    'service_role',
    'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)',
    'execute'
  ),
  true,
  'The existing trusted entitlement command retains service-role execution'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)',
    'execute'
  ),
  false,
  'Normal authenticated users cannot self-grant sponsored access'
);
select is(
  has_function_privilege(
    'anon',
    'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)',
    'execute'
  ),
  false,
  'Anonymous users cannot grant sponsored access'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-0000000022d1','authenticated','authenticated','d0-sponsored@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022d2','authenticated','authenticated','d0-offer@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022d3','authenticated','authenticated','d0-legacy@example.invalid',now(),'{}',now(),now());

set local role authenticated;
select throws_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','PERSONAL','ACTIVE','family_comp_2026',null
  )$$,
  '42501',
  null,
  'An authenticated identity cannot self-grant sponsored access'
);
reset role;

set local role anon;
select throws_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','PERSONAL','ACTIVE','family_comp_2026',null
  )$$,
  '42501',
  null,
  'An anonymous caller cannot grant sponsored access'
);
reset role;

set local role service_role;
select throws_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022df','PERSONAL','ACTIVE','family_comp_2026',null
  )$$,
  '23503',
  null,
  'Sponsored access requires an existing exact canonical identity'
);
select throws_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','CONSULTING','ACTIVE','family_comp_2026',null
  )$$,
  '22023',
  'Sponsored access must use the Personal entitlement lifecycle.',
  'The sponsored source cannot authorize another product'
);
select throws_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','PERSONAL','PENDING','family_comp_2026',null
  )$$,
  '22023',
  'Sponsored access must use the Personal entitlement lifecycle.',
  'The sponsored source cannot create a pending eligibility marker'
);
reset role;

select throws_ok(
  $$insert into entry_identity.product_entitlements(
      canonical_user_id, product, status, source, authority_kind
    ) values (
      '00000000-0000-4000-8000-0000000022d1','CONSULTING','ACTIVE',
      'family_comp_2026','SPONSORED_ACCESS'
    )$$,
  '23514',
  null,
  'The schema rejects sponsored authority for a non-Personal product'
);
select throws_ok(
  $$insert into entry_identity.product_entitlements(
      canonical_user_id, product, status, source, authority_kind
    ) values (
      '00000000-0000-4000-8000-0000000022d1','PERSONAL','PENDING',
      'family_comp_2026','SPONSORED_ACCESS'
    )$$,
  '23514',
  null,
  'The schema rejects pending sponsored authority outside its lifecycle'
);

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','PERSONAL','ACTIVE','family_comp_2026','Sponsored Test User'
  )$$,
  'A trusted explicit action can grant sponsored Personal access'
);
reset role;

select results_eq(
  $$select product::text || ':' || status::text || ':' || authority_kind::text || ':' || source
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'$$,
  array['PERSONAL:ACTIVE:SPONSORED_ACCESS:family_comp_2026'],
  'The sponsored grant records the exact locked authority contract'
);
select is(
  (select status = 'ACTIVE'
      and product = 'PERSONAL'
      and authority_kind = 'SPONSORED_ACCESS'
   from entry_identity.product_entitlements
   where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'),
  true,
  'Sponsored Personal ACTIVE is structurally capable of authorizing future access'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000022d1","role":"authenticated"}',
  true
);
select results_eq(
  $$select product::text from public.get_my_active_entry_products()$$,
  array['PERSONAL'],
  'The accepted active-product resolver recognizes the explicit sponsored grant'
);
reset role;

select results_eq(
  $$select count(*) from entry_identity.personal_billing_accounts
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'$$,
  array[0::bigint],
  'Sponsored access requires no Stripe billing account'
);
select results_eq(
  $$select count(*) from entry_identity.stripe_reconciliation_events
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'$$,
  array[0::bigint],
  'Sponsored access creates no Stripe reconciliation evidence'
);
select results_eq(
  $$select (metadata->>'status') || ':' || (metadata->>'source') || ':' || (metadata->>'authority_kind')
    from entry_identity.identity_audit_events
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'
      and event_type = 'ENTRY_PRODUCT_ENTITLEMENT_SET'$$,
  array['ACTIVE:family_comp_2026:SPONSORED_ACCESS'],
  'The exact sponsored grant is audited'
);

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','PERSONAL','SUSPENDED','family_comp_2026',null
  )$$,
  'A trusted action can suspend the exact sponsored entitlement'
);
reset role;
select results_eq(
  $$select status::text || ':' || authority_kind::text || ':' || source
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'$$,
  array['SUSPENDED:SPONSORED_ACCESS:family_comp_2026'],
  'Suspension retains sponsored authority and source'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000022d1","role":"authenticated"}',
  true
);
select is_empty(
  $$select product from public.get_my_active_entry_products()$$,
  'Suspended sponsored access no longer authorizes Personal'
);
reset role;

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d1','PERSONAL','REVOKED','family_comp_2026',null
  )$$,
  'A trusted action can revoke the exact sponsored entitlement'
);
reset role;
select results_eq(
  $$select status::text || ':' || authority_kind::text || ':' || source || ':' || (revoked_at is not null)::text
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'$$,
  array['REVOKED:SPONSORED_ACCESS:family_comp_2026:true'],
  'Revocation retains sponsored provenance and records its timestamp'
);
select results_eq(
  $$select count(*) from entry_identity.identity_audit_events
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d1'
      and event_type = 'ENTRY_PRODUCT_ENTITLEMENT_SET'$$,
  array[3::bigint],
  'Grant, suspension, and revocation are each audited'
);

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d2','PERSONAL','PENDING','sotf_founding_fellow_2026',null
  )$$,
  'The accepted SOTF offer-eligibility path remains valid'
);
reset role;
select results_eq(
  $$select status::text || ':' || authority_kind::text
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d2'$$,
  array['PENDING:OFFER_ELIGIBILITY'],
  'Offer eligibility remains pending and non-authorizing'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000022d2","role":"authenticated"}',
  true
);
select is_empty(
  $$select product from public.get_my_active_entry_products()$$,
  'Offer eligibility still cannot authorize runtime Personal access'
);
reset role;

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022d3','PERSONAL','ACTIVE',
    'phase_2_1_prebilling_automatic_personal',null
  )$$,
  'Phase 2.1 automatic Personal provisioning remains valid'
);
reset role;
select results_eq(
  $$select status::text || ':' || authority_kind::text || ':' || source
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022d3'$$,
  array['ACTIVE:LEGACY_PREBILLING:phase_2_1_prebilling_automatic_personal'],
  'Phase 2.1 authority semantics remain unchanged'
);
select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Billing cutover remains disabled'
);

select * from finish();
rollback;
