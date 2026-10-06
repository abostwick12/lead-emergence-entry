begin;
select plan(36);

select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Entry Phase 2.2 enforcement remains disabled by default'
);
select is(
  (select relrowsecurity from pg_class
   where oid = 'entry_identity.personal_projection_outbox'::regclass),
  true,
  'The PERSONAL projection outbox uses RLS'
);
select is(has_table_privilege('authenticated','entry_identity.personal_projection_outbox','select'),false,
  'Ordinary authenticated callers cannot read the outbox');
select is(has_function_privilege('service_role','public.claim_entry_personal_projection_batch(integer)','execute'),true,
  'The Entry service role can run the bounded drain claim');
select is(has_function_privilege('authenticated','public.claim_entry_personal_projection_batch(integer)','execute'),false,
  'Ordinary authenticated callers cannot drain projections');
select is(has_function_privilege('anon','public.claim_entry_personal_projection_batch(integer)','execute'),false,
  'Anonymous callers cannot drain projections');
select results_eq(
  $$select pending_count from public.get_entry_personal_projection_lag()$$,
  array[0::bigint],
  'Projection lag begins empty'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-00000000e001','authenticated','authenticated','slice-d-entry-billing@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000e002','authenticated','authenticated','slice-d-entry-legacy@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-00000000e003','authenticated','authenticated','slice-d-entry-offer@example.invalid',now(),'{}',now(),now());

insert into entry_identity.personal_billing_accounts(
  canonical_user_id,selected_offer,stripe_checkout_session_id,normalized_state
) values (
  '00000000-0000-4000-8000-00000000e001','STANDARD_INDIVIDUAL','checkout_attempt_00000000-0000-4000-8000-00000000e101','PENDING_CHECKOUT'
);
select results_eq(
  $$select count(*) from entry_identity.personal_projection_outbox
    where canonical_user_id = '00000000-0000-4000-8000-00000000e001'$$,
  array[0::bigint],
  'Checkout reservation does not enqueue access authority'
);

update entry_identity.personal_billing_accounts
set normalized_state = 'ACTIVE',
    latest_reconciliation_version = 1,
    latest_stripe_event_id = 'evt_slice_d_active',
    updated_at = now()
where canonical_user_id = '00000000-0000-4000-8000-00000000e001';
select results_eq(
  $$select projection_kind::text from entry_identity.personal_projection_outbox
    where canonical_user_id = '00000000-0000-4000-8000-00000000e001'$$,
  array['BILLING'],
  'A reconciled billing mutation transactionally enqueues a billing projection'
);
select ok(
  not exists (
    select 1 from entry_identity.personal_projection_outbox
    where projection_data ?| array['stripe_customer_id','stripe_subscription_id','stripe_checkout_session_id']
  ),
  'Outbox payloads contain no Stripe identifiers'
);
select ok(
  (select projection_version > 0 from entry_identity.personal_projection_outbox
   where canonical_user_id = '00000000-0000-4000-8000-00000000e001'),
  'The outbox identity is a positive monotonic projection version'
);

create temporary table claimed_projection as
select * from public.claim_entry_personal_projection_batch(10);
select results_eq(
  $$select attempts from claimed_projection$$,
  array[1],
  'Claiming a pending projection records its first attempt'
);
select ok(
  public.mark_entry_personal_projection_delivery(
    (select delivery_id from claimed_projection),false,'WORKSPACE_TRANSPORT_UNAVAILABLE'
  ),
  'A failed delivery result is persisted without rejecting canonical truth'
);
select results_eq(
  $$select delivery_state::text from entry_identity.personal_projection_outbox
    where delivery_id = (select delivery_id from claimed_projection)$$,
  array['PENDING'],
  'Failed delivery remains retryable'
);
select results_eq(
  $$select last_error from entry_identity.personal_projection_outbox
    where delivery_id = (select delivery_id from claimed_projection)$$,
  array['WORKSPACE_TRANSPORT_UNAVAILABLE'],
  'Only a sanitized delivery error is retained'
);
select results_eq(
  $$select pending_count from public.get_entry_personal_projection_lag()$$,
  array[1::bigint],
  'Pending projection lag is detectable'
);
select is(
  (select normalized_state::text from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-00000000e001'),
  'ACTIVE',
  'Projection failure cannot roll back canonical billing truth'
);
select results_eq(
  $$select delivery_id from public.claim_entry_personal_projection_batch(10)$$,
  array[(select delivery_id from claimed_projection)],
  'A later drain retries the exact same delivery identity'
);
select ok(
  public.mark_entry_personal_projection_delivery(
    (select delivery_id from claimed_projection),true,null
  ),
  'A successful retry marks the projection delivered'
);
select results_eq(
  $$select pending_count from public.get_entry_personal_projection_lag()$$,
  array[0::bigint],
  'Successful delivery clears observable lag'
);

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-00000000e001','PERSONAL','ACTIVE','family_comp_2026',null
  )$$,
  'A sponsored authority mutation remains accepted'
);
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-00000000e002','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null
  )$$,
  'The historical legacy automatic grant remains preserved'
);
select lives_ok(
  $$select * from public.set_entry_product_entitlement(
    '00000000-0000-4000-8000-00000000e003','PERSONAL','PENDING','sotf_founding_fellow_2026',null
  )$$,
  'Offer eligibility remains preserved'
);
reset role;

select results_eq(
  $$select projection_kind::text || ':' || (projection_data->>'authority_kind')
    from entry_identity.personal_projection_outbox
    where canonical_user_id = '00000000-0000-4000-8000-00000000e001'
      and projection_kind = 'NON_BILLING_AUTHORITY'$$,
  array['NON_BILLING_AUTHORITY:SPONSORED_ACCESS'],
  'Sponsored access enqueues a distinct non-billing authority projection'
);
select results_eq(
  $$select count(*) from entry_identity.personal_projection_outbox
    where canonical_user_id = '00000000-0000-4000-8000-00000000e002'$$,
  array[0::bigint],
  'LEGACY_PREBILLING is never projected as post-cutover access'
);
select results_eq(
  $$select count(*) from entry_identity.personal_projection_outbox
    where canonical_user_id = '00000000-0000-4000-8000-00000000e003'$$,
  array[0::bigint],
  'OFFER_ELIGIBILITY is never projected as access'
);
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e002',now()),true,
  'Cutover disabled preserves legacy Phase 2.1 Personal authorization'
);

update entry_identity.billing_cutover_control
set enabled = true, updated_at = now()
where setting_key = 'phase_2_2_billing_enforcement_enabled';
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e002',now()),false,
  'LEGACY_PREBILLING alone does not authorize when cutover is enabled locally'
);
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e003',now()),false,
  'OFFER_ELIGIBILITY does not authorize when cutover is enabled locally'
);
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e001',now()),true,
  'Active billing or sponsored authority authorizes through OR semantics'
);

update entry_identity.personal_billing_accounts
set normalized_state = 'PAYMENT_GRACE', grace_started_at = now() - interval '1 day',
    grace_until = now() + interval '1 day', latest_reconciliation_version = 2
where canonical_user_id = '00000000-0000-4000-8000-00000000e001';
update entry_identity.product_entitlements
set status = 'SUSPENDED', updated_at = now()
where canonical_user_id = '00000000-0000-4000-8000-00000000e001' and product = 'PERSONAL';
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e001',now()),true,
  'PAYMENT_GRACE before its deadline authorizes without sponsored access'
);
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e001',now() + interval '2 days'),false,
  'Expired PAYMENT_GRACE denies even when the persisted enum has not changed'
);

update entry_identity.personal_billing_accounts
set normalized_state = 'CANCELED', grace_started_at = null, grace_until = null,
    latest_reconciliation_version = 3
where canonical_user_id = '00000000-0000-4000-8000-00000000e001';
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e001',now()),false,
  'Canceled billing plus suspended sponsored authority denies'
);

update entry_identity.product_entitlements
set authority_kind = 'INTERNAL_OPERATOR', status = 'ACTIVE', source = 'operator_allowlist', updated_at = now()
where canonical_user_id = '00000000-0000-4000-8000-00000000e001' and product = 'PERSONAL';
select is(entry_identity.has_effective_personal_access(
  '00000000-0000-4000-8000-00000000e001',now()),true,
  'Active internal operator authority permits access without billing'
);
select results_eq(
  $$select projection_data->>'authority_kind'
    from entry_identity.personal_projection_outbox
    where canonical_user_id = '00000000-0000-4000-8000-00000000e001'
      and projection_kind = 'NON_BILLING_AUTHORITY'
    order by projection_version desc limit 1$$,
  array['INTERNAL_OPERATOR'],
  'Internal operator is normalized through the non-billing projection path'
);
select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  true,
  'The enabled state exists only inside this rolled-back local acceptance transaction'
);

select * from finish();
rollback;
