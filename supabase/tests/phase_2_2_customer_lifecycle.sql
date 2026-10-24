begin;
select plan(36);

select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Entry billing enforcement remains disabled'
);
select has_column('entry_identity','personal_billing_accounts','discount_removal_due',
  'Billing accounts record whether SOTF discount removal is due');
select has_column('entry_identity','personal_billing_accounts','discount_removal_attempt_count',
  'Billing accounts retain bounded removal-attempt evidence');
select has_column('entry_identity','personal_billing_accounts','discount_removal_last_attempt_at',
  'Billing accounts retain the latest removal attempt time');
select has_column('entry_identity','personal_billing_accounts','discount_removal_last_error_code',
  'Billing accounts retain only a sanitized removal error code');
select has_column('entry_identity','personal_billing_accounts','discount_removed_at',
  'Billing accounts retain completed removal evidence');
select has_trigger(
  'entry_identity','personal_billing_accounts','personal_billing_accounts_set_discount_removal_due',
  'Paid cycle 12 transactionally marks discount removal due'
);
select has_function('public','get_entry_billing_lifecycle_context',array['uuid'],
  'Entry exposes a canonical lifecycle context resolver');
select has_function('public','get_pending_entry_sotf_discount_removals',array['integer'],
  'Entry exposes a bounded pending discount-removal reader');
select has_function(
  'public','record_entry_sotf_discount_removal_attempt',array['uuid','boolean','text'],
  'Entry exposes one discount-removal evidence command'
);
select is(
  has_function_privilege('authenticated','public.get_entry_billing_lifecycle_context(uuid)','execute'),
  false,
  'Authenticated clients cannot read private billing lifecycle context'
);
select is(
  has_function_privilege('service_role','public.get_entry_billing_lifecycle_context(uuid)','execute'),
  true,
  'The Entry service role can resolve lifecycle context'
);
select is(
  has_function_privilege('authenticated','public.get_pending_entry_sotf_discount_removals(integer)','execute'),
  false,
  'Authenticated clients cannot enumerate pending Stripe mutations'
);
select is(
  has_function_privilege('service_role','public.get_pending_entry_sotf_discount_removals(integer)','execute'),
  true,
  'The Entry service role can load a bounded mutation batch'
);
select is(
  has_function_privilege('authenticated','public.record_entry_sotf_discount_removal_attempt(uuid,boolean,text)','execute'),
  false,
  'Authenticated clients cannot forge discount-removal evidence'
);
select is(
  has_function_privilege('service_role','public.record_entry_sotf_discount_removal_attempt(uuid,boolean,text)','execute'),
  true,
  'The Entry service role can record removal evidence'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-0000000022e1','authenticated','authenticated','slice-e-sotf@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022e2','authenticated','authenticated','slice-e-standard@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022e3','authenticated','authenticated','slice-e-sponsored-only@example.invalid',now(),'{}',now(),now());

insert into entry_identity.personal_billing_accounts(
  canonical_user_id,stripe_customer_id,stripe_subscription_id,stripe_checkout_session_id,
  selected_offer,normalized_state,sotf_qualifying_paid_cycles
) values (
  '00000000-0000-4000-8000-0000000022e1','cus_slice_e_sotf','sub_slice_e_sotf',
  'cs_slice_e_sotf','SOTF_FOUNDING_FELLOW','ACTIVE',11
);

select is(
  (select discount_removal_due from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  false,
  'Paid cycles 1 through 11 do not make removal due'
);
select is(
  (select count(*) from public.get_pending_entry_sotf_discount_removals(5)),
  0::bigint,
  'No outbound discount mutation is exposed before paid cycle 12'
);
select results_eq(
  $$select canonical_user_id::text || ':' || stripe_customer_id || ':' || stripe_subscription_id
    from public.get_entry_billing_lifecycle_context('00000000-0000-4000-8000-0000000022e1')$$,
  array['00000000-0000-4000-8000-0000000022e1:cus_slice_e_sotf:sub_slice_e_sotf'],
  'Lifecycle context resolves the exact canonical Customer and Subscription mapping'
);
select is(
  (select count(*) from public.get_entry_billing_lifecycle_context(
    '00000000-0000-4000-8000-0000000022e3')),
  0::bigint,
  'A sponsored-only identity has no Stripe lifecycle context created'
);

update entry_identity.personal_billing_accounts
set sotf_qualifying_paid_cycles = 12,
    latest_reconciliation_version = 12,
    latest_stripe_event_id = 'evt_slice_e_twelfth',
    updated_at = now()
where canonical_user_id = '00000000-0000-4000-8000-0000000022e1';

select is(
  (select discount_removal_due from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  true,
  'The twelfth successfully applied paid cycle makes removal due'
);
select results_eq(
  $$select canonical_user_id::text || ':' || sotf_qualifying_paid_cycles::text
    from public.get_pending_entry_sotf_discount_removals(5)$$,
  array['00000000-0000-4000-8000-0000000022e1:12'],
  'Only the exact cycle-12 SOTF subscription is returned for removal'
);
select results_eq(
  $$select discount_removal_due from public.record_entry_sotf_discount_removal_attempt(
    '00000000-0000-4000-8000-0000000022e1',false,'STRIPE_TEMPORARILY_UNAVAILABLE')$$,
  array[true],
  'A failed outbound attempt retains the retryable due state'
);
select results_eq(
  $$select discount_removal_attempt_count::text || ':' || discount_removal_last_error_code
    from entry_identity.personal_billing_accounts
    where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'$$,
  array['1:STRIPE_TEMPORARILY_UNAVAILABLE'],
  'A failed attempt records one sanitized error code'
);
select is(
  (select normalized_state::text from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  'ACTIVE',
  'Discount-removal evidence never manufactures a billing-state transition'
);
select results_eq(
  $$select discount_removal_due from public.record_entry_sotf_discount_removal_attempt(
    '00000000-0000-4000-8000-0000000022e1',true,null)$$,
  array[false],
  'A successful removal clears the due state'
);
select ok(
  (select discount_removed_at is not null from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  'A successful removal retains durable completion evidence'
);
select is(
  (select discount_removal_attempt_count from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  2,
  'Failure followed by success records exactly two attempts'
);
select is(
  (select count(*) from public.get_pending_entry_sotf_discount_removals(5)),
  0::bigint,
  'Completed removal leaves the retry batch'
);
select lives_ok(
  $$select * from public.record_entry_sotf_discount_removal_attempt(
    '00000000-0000-4000-8000-0000000022e1',true,null)$$,
  'A repeated successful completion is idempotent'
);
select is(
  (select discount_removal_attempt_count from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  2,
  'An idempotent completion does not invent another attempt'
);
update entry_identity.personal_billing_accounts
set updated_at = now()
where canonical_user_id = '00000000-0000-4000-8000-0000000022e1';
select is(
  (select discount_removal_due from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'),
  false,
  'Ordinary later updates cannot reintroduce a removed discount'
);

insert into entry_identity.personal_billing_accounts(
  canonical_user_id,stripe_customer_id,stripe_subscription_id,stripe_checkout_session_id,
  selected_offer,normalized_state
) values (
  '00000000-0000-4000-8000-0000000022e2','cus_slice_e_standard','sub_slice_e_standard',
  'cs_slice_e_standard','STANDARD_INDIVIDUAL','ACTIVE'
);
select is(
  (select discount_removal_due from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022e2'),
  false,
  'Standard billing never enters SOTF discount-removal state'
);
select throws_ok(
  $$select * from public.record_entry_sotf_discount_removal_attempt(
    '00000000-0000-4000-8000-0000000022e2',true,null)$$,
  '22023',
  'SOTF discount removal is not due.',
  'Standard billing cannot use the SOTF removal command'
);
select throws_ok(
  $$update entry_identity.personal_billing_accounts
    set sotf_qualifying_paid_cycles = 13
    where canonical_user_id = '00000000-0000-4000-8000-0000000022e1'$$,
  '23514',
  null,
  'The paid-cycle count remains capped at 12'
);
select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Slice E leaves Entry billing enforcement disabled'
);

select * from finish();
rollback;
