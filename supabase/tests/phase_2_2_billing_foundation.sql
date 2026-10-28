begin;
select plan(23);

select is(
  (select relrowsecurity from pg_class where oid = 'entry_identity.personal_billing_accounts'::regclass),
  true,
  'Entry billing accounts are RLS protected'
);
select is(
  (select relrowsecurity from pg_class where oid = 'entry_identity.stripe_reconciliation_events'::regclass),
  true,
  'Entry reconciliation events are RLS protected'
);
select is(
  (select relrowsecurity from pg_class where oid = 'entry_identity.billing_cutover_control'::regclass),
  true,
  'Entry cutover control is RLS protected'
);
select is(
  has_table_privilege('authenticated', 'entry_identity.personal_billing_accounts', 'select'),
  false,
  'Authenticated clients cannot read canonical billing state'
);
select is(
  has_table_privilege('authenticated', 'entry_identity.stripe_reconciliation_events', 'insert'),
  false,
  'Authenticated clients cannot manufacture reconciliation events'
);
select is(
  (select enabled from entry_identity.billing_cutover_control where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Entry billing enforcement defaults disabled'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'entry_identity'
     and table_name = 'product_entitlements'
     and column_name = 'authority_kind'),
  null,
  'Historical entitlement rows are not reclassified by a column default'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-0000000022a1','authenticated','authenticated','phase22-a@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022a2','authenticated','authenticated','phase22-b@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022a3','authenticated','authenticated','phase22-c@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022a4','authenticated','authenticated','phase22-d@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022a5','authenticated','authenticated','phase22-e@example.invalid',now(),'{}',now(),now());

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022a1',
    'PERSONAL',
    'ACTIVE',
    'phase_2_1_prebilling_automatic_personal',
    'Phase 2.1 Legacy User'
  )$$,
  'The existing Phase 2.1 provisioning command still activates Personal'
);
reset role;

select results_eq(
  $$select status::text || ':' || source || ':' || authority_kind::text
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022a1'
      and product = 'PERSONAL'$$,
  array['ACTIVE:phase_2_1_prebilling_automatic_personal:LEGACY_PREBILLING'],
  'The legacy marker is preserved and future legacy writes are distinguishable'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000022a1","role":"authenticated"}',
  true
);
select results_eq(
  $$select product::text from public.get_my_active_entry_products()$$,
  array['PERSONAL'],
  'Phase 2.1 runtime eligibility remains active while cutover is disabled'
);
reset role;

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-0000000022a2',
    'PERSONAL',
    'PENDING',
    'sotf_founding_fellow_2026',
    'SOTF Candidate'
  )$$,
  'The audited command records SOTF offer eligibility without a parallel invitation path'
);
reset role;

select results_eq(
  $$select status::text || ':' || authority_kind::text || ':' || source
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022a2'
      and product = 'PERSONAL'$$,
  array['PENDING:OFFER_ELIGIBILITY:sotf_founding_fellow_2026'],
  'SOTF eligibility uses the exact pending authority contract'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000022a2","role":"authenticated"}',
  true
);
select is_empty(
  $$select product from public.get_my_active_entry_products()$$,
  'Pending offer eligibility cannot authorize Personal runtime access'
);
reset role;

select throws_ok(
  $$insert into entry_identity.product_entitlements(
      canonical_user_id, product, status, source, authority_kind
    ) values (
      '00000000-0000-4000-8000-0000000022a3',
      'PERSONAL',
      'ACTIVE',
      'invalid_offer_activation',
      'OFFER_ELIGIBILITY'
    )$$,
  '23514',
  null,
  'The schema rejects active offer eligibility'
);

insert into entry_identity.product_entitlements(
  canonical_user_id, product, status, source, authority_kind
) values
  ('00000000-0000-4000-8000-0000000022a3','PERSONAL','ACTIVE','operator_override','INTERNAL_OPERATOR'),
  ('00000000-0000-4000-8000-0000000022a4','PERSONAL','ACTIVE','billing_reconciliation','BILLING');
select results_eq(
  $$select authority_kind::text
    from entry_identity.product_entitlements
    where canonical_user_id in (
      '00000000-0000-4000-8000-0000000022a3',
      '00000000-0000-4000-8000-0000000022a4'
    )
    order by authority_kind::text$$,
  array['BILLING','INTERNAL_OPERATOR'],
  'Internal operator authority is structurally distinct from billing authority'
);

insert into entry_identity.personal_billing_accounts(
  canonical_user_id, stripe_customer_id, stripe_subscription_id,
  stripe_checkout_session_id, selected_offer
) values (
  '00000000-0000-4000-8000-0000000022a1',
  'cus_phase22_unique',
  'sub_phase22_unique',
  'cs_phase22_unique',
  'SOTF_FOUNDING_FELLOW'
);

select throws_ok(
  $$insert into entry_identity.personal_billing_accounts(
      canonical_user_id, stripe_customer_id, selected_offer
    ) values (
      '00000000-0000-4000-8000-0000000022a2',
      'cus_phase22_unique',
      'STANDARD_INDIVIDUAL'
    )$$,
  '23505', null,
  'One Stripe customer cannot be attached to multiple canonical users'
);
select throws_ok(
  $$insert into entry_identity.personal_billing_accounts(
      canonical_user_id, stripe_subscription_id, selected_offer
    ) values (
      '00000000-0000-4000-8000-0000000022a2',
      'sub_phase22_unique',
      'STANDARD_INDIVIDUAL'
    )$$,
  '23505', null,
  'One Stripe subscription cannot be attached to multiple canonical users'
);
select throws_ok(
  $$insert into entry_identity.personal_billing_accounts(
      canonical_user_id, stripe_checkout_session_id, selected_offer
    ) values (
      '00000000-0000-4000-8000-0000000022a2',
      'cs_phase22_unique',
      'STANDARD_INDIVIDUAL'
    )$$,
  '23505', null,
  'One checkout session cannot be attached to multiple canonical users'
);

insert into entry_identity.stripe_reconciliation_events(
  canonical_user_id, stripe_event_id, event_type, stripe_object_id,
  enforce_logical_object_dedupe, invoice_amount_paid, qualifying_paid_cycle,
  paid_cycle_applied_at, reconciliation_version, reconciliation_outcome,
  stripe_event_created_at
) values (
  '00000000-0000-4000-8000-0000000022a1',
  'evt_phase22_invoice_one',
  'invoice.paid',
  'in_phase22_paid_one',
  true,
  1900,
  true,
  now(),
  1,
  'APPLIED',
  now()
);

select throws_ok(
  $$insert into entry_identity.stripe_reconciliation_events(
      canonical_user_id, stripe_event_id, event_type, stripe_object_id,
      reconciliation_version, stripe_event_created_at
    ) values (
      '00000000-0000-4000-8000-0000000022a1',
      'evt_phase22_invoice_one',
      'customer.updated',
      'cus_other_object',
      2,
      now()
    )$$,
  '23505', null,
  'A Stripe event ID cannot be persisted twice'
);
select throws_ok(
  $$insert into entry_identity.stripe_reconciliation_events(
      canonical_user_id, stripe_event_id, event_type, stripe_object_id,
      enforce_logical_object_dedupe, invoice_amount_paid, qualifying_paid_cycle,
      paid_cycle_applied_at, reconciliation_version, reconciliation_outcome,
      stripe_event_created_at
    ) values (
      '00000000-0000-4000-8000-0000000022a1',
      'evt_phase22_invoice_replay',
      'invoice.paid',
      'in_phase22_paid_one',
      true,
      1900,
      true,
      now(),
      2,
      'APPLIED',
      now()
    )$$,
  '23505', null,
  'Two Stripe events cannot apply the same qualifying invoice twice'
);
select throws_ok(
  $$insert into entry_identity.stripe_reconciliation_events(
      canonical_user_id, stripe_event_id, event_type, stripe_object_id,
      enforce_logical_object_dedupe, invoice_amount_paid, qualifying_paid_cycle,
      reconciliation_version, stripe_event_created_at
    ) values (
      '00000000-0000-4000-8000-0000000022a1',
      'evt_phase22_zero_invoice',
      'invoice.paid',
      'in_phase22_zero',
      true,
      0,
      true,
      3,
      now()
    )$$,
  '23514', null,
  'A zero-dollar invoice cannot be marked as a qualifying paid cycle'
);
select results_eq(
  $$select count(*) from entry_identity.stripe_reconciliation_events
    where qualifying_paid_cycle and stripe_object_id = 'in_phase22_paid_one'$$,
  array[1::bigint],
  'Exactly one ledger application exists for a qualifying paid invoice'
);
select is(
  (select sotf_qualifying_paid_cycles
   from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022a1'),
  0::smallint,
  'Slice A does not begin webhook processing or mutate the paid-cycle counter'
);

select * from finish();
rollback;
