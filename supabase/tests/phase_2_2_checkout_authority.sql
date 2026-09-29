begin;
select plan(21);

select has_function(
  'public',
  'has_entry_sotf_checkout_eligibility',
  array['uuid'],
  'Entry exposes one exact SOTF eligibility predicate to its trusted server'
);
select is(
  has_function_privilege('authenticated', 'public.has_entry_sotf_checkout_eligibility(uuid)', 'execute'),
  false,
  'Authenticated clients cannot invoke SOTF eligibility authority'
);
select is(
  has_function_privilege('service_role', 'public.has_entry_sotf_checkout_eligibility(uuid)', 'execute'),
  true,
  'The Entry service role can invoke SOTF eligibility authority'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reserve_entry_billing_checkout(uuid,entry_identity.personal_commercial_offer,text,text)',
    'execute'
  ),
  false,
  'Authenticated clients cannot reserve Checkout attempts'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reserve_entry_billing_checkout(uuid,entry_identity.personal_commercial_offer,text,text)',
    'execute'
  ),
  true,
  'The Entry service role can reserve Checkout attempts'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-0000000022b1','authenticated','authenticated','checkout-sotf@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022b2','authenticated','authenticated','checkout-near-match@example.invalid',now(),'{}',now(),now());

insert into entry_identity.product_entitlements(
  canonical_user_id, product, status, source, authority_kind
) values
  ('00000000-0000-4000-8000-0000000022b1','PERSONAL','PENDING','sotf_founding_fellow_2026','OFFER_ELIGIBILITY'),
  ('00000000-0000-4000-8000-0000000022b2','PERSONAL','PENDING','another_offer','OFFER_ELIGIBILITY');

set local role service_role;
select is(
  public.has_entry_sotf_checkout_eligibility('00000000-0000-4000-8000-0000000022b1'),
  true,
  'Exact PERSONAL/PENDING/OFFER_ELIGIBILITY/source authority qualifies for SOTF Checkout'
);
select is(
  public.has_entry_sotf_checkout_eligibility('00000000-0000-4000-8000-0000000022b2'),
  false,
  'A near-match source cannot qualify for SOTF Checkout'
);

select results_eq(
  $$select reservation_disposition || ':' || selected_offer::text
    from public.reserve_entry_billing_checkout(
      '00000000-0000-4000-8000-0000000022b1',
      'SOTF_FOUNDING_FELLOW',
      'checkout_attempt_00000000-0000-4000-8000-0000000022b3',
      null
    )$$,
  array['RESERVED:SOTF_FOUNDING_FELLOW'],
  'The trusted server atomically reserves the first Checkout attempt'
);
select results_eq(
  $$select reservation_disposition
    from public.reserve_entry_billing_checkout(
      '00000000-0000-4000-8000-0000000022b1',
      'SOTF_FOUNDING_FELLOW',
      'checkout_attempt_00000000-0000-4000-8000-0000000022b4',
      null
    )$$,
  array['IN_PROGRESS'],
  'A concurrent request is deterministically blocked by the active reservation'
);
select is(
  public.complete_entry_billing_checkout(
    '00000000-0000-4000-8000-0000000022b1',
    'SOTF_FOUNDING_FELLOW',
    'checkout_attempt_00000000-0000-4000-8000-0000000022b3',
    'cus_checkout_slice_b',
    'cs_test_checkout_slice_b'
  ),
  true,
  'The reservation owner can persist server-created Stripe identifiers'
);
reset role;

select results_eq(
  $$select stripe_customer_id || ':' || stripe_checkout_session_id || ':' || normalized_state::text
    from entry_identity.personal_billing_accounts
    where canonical_user_id = '00000000-0000-4000-8000-0000000022b1'$$,
  array['cus_checkout_slice_b:cs_test_checkout_slice_b:PENDING_CHECKOUT'],
  'Checkout persistence retains pending state and canonical Stripe ownership'
);

set local role service_role;
select results_eq(
  $$select reservation_disposition || ':' || checkout_reference
    from public.reserve_entry_billing_checkout(
      '00000000-0000-4000-8000-0000000022b1',
      'SOTF_FOUNDING_FELLOW',
      'checkout_attempt_00000000-0000-4000-8000-0000000022b5',
      null
    )$$,
  array['EXISTING_SESSION:cs_test_checkout_slice_b'],
  'A later request receives the existing Checkout session reference'
);
select results_eq(
  $$select reservation_disposition || ':' || checkout_reference
    from public.reserve_entry_billing_checkout(
      '00000000-0000-4000-8000-0000000022b1',
      'SOTF_FOUNDING_FELLOW',
      'checkout_attempt_00000000-0000-4000-8000-0000000022b5',
      'cs_test_checkout_slice_b'
    )$$,
  array['RESERVED:checkout_attempt_00000000-0000-4000-8000-0000000022b5'],
  'A caller can replace only the exact Checkout reference it inspected as expired'
);
select is(
  public.release_entry_billing_checkout_reservation(
    '00000000-0000-4000-8000-0000000022b1',
    'checkout_attempt_00000000-0000-4000-8000-0000000022b5'
  ),
  true,
  'The reservation owner can release a failed Checkout attempt'
);
reset role;

select is(
  (select stripe_checkout_session_id
   from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022b1'),
  null,
  'Releasing an attempt clears only the Checkout reservation'
);
select results_eq(
  $$select status::text || ':' || authority_kind::text || ':' || source
    from entry_identity.product_entitlements
    where canonical_user_id = '00000000-0000-4000-8000-0000000022b1'
      and product = 'PERSONAL'$$,
  array['PENDING:OFFER_ELIGIBILITY:sotf_founding_fellow_2026'],
  'Checkout operations never activate the pending offer entitlement'
);
select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Entry billing cutover remains disabled'
);
select results_eq(
  $$select count(*) from entry_identity.identity_audit_events
    where canonical_user_id = '00000000-0000-4000-8000-0000000022b1'
      and event_type = 'ENTRY_BILLING_CHECKOUT_CREATED'$$,
  array[1::bigint],
  'Completed Checkout ownership is audited once'
);
select is(
  has_table_privilege('authenticated', 'entry_identity.personal_billing_accounts', 'select'),
  false,
  'Checkout work does not expose private billing state to clients'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.complete_entry_billing_checkout(uuid,entry_identity.personal_commercial_offer,text,text,text)',
    'execute'
  ),
  false,
  'Authenticated clients cannot persist Stripe ownership'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.release_entry_billing_checkout_reservation(uuid,text)',
    'execute'
  ),
  false,
  'Authenticated clients cannot release server reservations'
);

select * from finish();
rollback;
