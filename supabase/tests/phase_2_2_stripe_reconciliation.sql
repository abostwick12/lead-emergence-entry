begin;
select plan(45);

select has_function(
  'public',
  'get_entry_billing_reconciliation_context',
  array['text'],
  'Entry exposes one trusted Stripe Customer ownership resolver'
);
select has_function(
  'public',
  'apply_entry_stripe_reconciliation',
  array[
    'uuid','text','text','text','timestamp with time zone','text','text','text',
    'entry_identity.personal_billing_state','timestamp with time zone','boolean',
    'timestamp with time zone','timestamp with time zone','timestamp with time zone',
    'timestamp with time zone','boolean','integer','boolean','timestamp with time zone',
    'boolean','boolean','text'
  ],
  'Entry exposes one transactional Stripe reconciliation command'
);
select has_function(
  'public',
  'get_effective_entry_billing_state',
  array['uuid','timestamp with time zone'],
  'Entry exposes deterministic effective-state evaluation'
);
select is(
  has_function_privilege('authenticated', 'public.get_entry_billing_reconciliation_context(text)', 'execute'),
  false,
  'Authenticated clients cannot resolve private Stripe ownership'
);
select is(
  has_function_privilege('service_role', 'public.get_entry_billing_reconciliation_context(text)', 'execute'),
  true,
  'The Entry service role can resolve Stripe ownership'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.apply_entry_stripe_reconciliation(uuid,text,text,text,timestamp with time zone,text,text,text,entry_identity.personal_billing_state,timestamp with time zone,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,boolean,integer,boolean,timestamp with time zone,boolean,boolean,text)',
    'execute'
  ),
  false,
  'Authenticated clients cannot apply Stripe reconciliation'
);
select is(
  has_function_privilege(
    'service_role',
    'public.apply_entry_stripe_reconciliation(uuid,text,text,text,timestamp with time zone,text,text,text,entry_identity.personal_billing_state,timestamp with time zone,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,boolean,integer,boolean,timestamp with time zone,boolean,boolean,text)',
    'execute'
  ),
  true,
  'The Entry service role can apply verified Stripe reconciliation'
);
select is(
  has_function_privilege('authenticated', 'public.get_effective_entry_billing_state(uuid,timestamp with time zone)', 'execute'),
  false,
  'Authenticated clients cannot read effective private billing state'
);

create function pg_temp.apply_event(
  p_user uuid,
  p_event text,
  p_type text,
  p_object text,
  p_customer text,
  p_subscription text,
  p_state entry_identity.personal_billing_state default null,
  p_setup timestamptz default null,
  p_payment_required boolean default null,
  p_amount integer default null,
  p_qualifying boolean default false,
  p_grace timestamptz default null,
  p_clear boolean default false,
  p_logical boolean default false,
  p_outcome text default 'APPLIED',
  p_checkout text default null,
  p_cancel boolean default null
) returns table(
  application_result text,
  resulting_state entry_identity.personal_billing_state,
  effective_state entry_identity.personal_billing_state,
  resulting_paid_cycles smallint
)
language sql
as $$
  select * from public.apply_entry_stripe_reconciliation(
    p_user,
    p_event,
    p_type,
    p_object,
    '2026-09-19 00:00:00+00',
    p_customer,
    p_subscription,
    p_checkout,
    p_state,
    p_setup,
    p_payment_required,
    null,
    null,
    null,
    null,
    p_cancel,
    p_amount,
    p_qualifying,
    p_grace,
    p_clear,
    p_logical,
    p_outcome
  );
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-4000-8000-0000000022c1','authenticated','authenticated','slice-c-standard@example.invalid',now(),'{}',now(),now()),
  ('00000000-0000-4000-8000-0000000022c2','authenticated','authenticated','slice-c-sotf@example.invalid',now(),'{}',now(),now());

insert into entry_identity.personal_billing_accounts(
  canonical_user_id, stripe_customer_id, stripe_checkout_session_id,
  selected_offer, normalized_state
) values
  ('00000000-0000-4000-8000-0000000022c1','cus_slice_c_standard','cs_slice_c_standard','STANDARD_INDIVIDUAL','PENDING_CHECKOUT'),
  ('00000000-0000-4000-8000-0000000022c2','cus_slice_c_sotf','cs_slice_c_sotf','SOTF_FOUNDING_FELLOW','TRIALING');

set local role service_role;
select throws_ok(
  $$select * from pg_temp.apply_event(
    '00000000-0000-4000-8000-0000000022c1','evt_unknown','customer.subscription.updated',
    'sub_unknown','cus_unknown','sub_unknown','ACTIVE'
  )$$,
  '23503',
  'Stripe Customer ownership mismatch.',
  'An unknown Stripe Customer fails closed'
);
select throws_ok(
  $$select * from pg_temp.apply_event(
    '00000000-0000-4000-8000-0000000022c1','evt_wrong_customer','customer.subscription.updated',
    'sub_standard','cus_slice_c_sotf','sub_standard','ACTIVE'
  )$$,
  '23503',
  'Stripe Customer ownership mismatch.',
  'A contradictory Customer and canonical user fails closed'
);
select results_eq(
  $$select canonical_user_id::text || ':' || selected_offer::text
    from public.get_entry_billing_reconciliation_context('cus_slice_c_standard')$$,
  array['00000000-0000-4000-8000-0000000022c1:STANDARD_INDIVIDUAL'],
  'Canonical Stripe Customer ownership resolves to exactly one Entry user and offer'
);

select results_eq(
  $$select application_result || ':' || resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_checkout_complete','checkout.session.completed',
      'cs_slice_c_standard','cus_slice_c_standard','sub_slice_c_standard','TRIALING',
      null,null,null,false,null,false,false,'APPLIED','cs_slice_c_standard'
    )$$,
  array['APPLIED:TRIALING'],
  'Standard Checkout completion binds the subscription but only records trialing state'
);
select is(
  (select setup_fee_paid_at from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c1'),
  null,
  'Standard Checkout completion alone does not prove setup payment'
);

select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_standard_setup_paid','invoice.paid',
      'in_standard_setup','cus_slice_c_standard','sub_slice_c_standard','TRIALING',
      '2026-09-19 00:01:00+00',false,19900,false,null,true,true
    )$$,
  array['APPLIED'],
  'A verified Standard initial paid invoice is applied'
);
select is(
  (select setup_fee_paid_at from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c1'),
  '2026-09-19 00:01:00+00'::timestamptz,
  'Standard setup payment is recorded once'
);
select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_standard_setup_paid','invoice.paid',
      'in_standard_setup','cus_slice_c_standard','sub_slice_c_standard','ACTIVE',
      '2026-09-20 00:01:00+00',false,19900,false,null,true,true
    )$$,
  array['DUPLICATE'],
  'A duplicate Stripe Event ID is a no-op'
);
select is(
  (select setup_fee_paid_at from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c1'),
  '2026-09-19 00:01:00+00'::timestamptz,
  'Replay cannot rewrite setup payment evidence'
);
select results_eq(
  $$select count(*) from entry_identity.stripe_reconciliation_events
    where stripe_object_id = 'in_standard_setup'$$,
  array[1::bigint],
  'Logical invoice deduplication records the Standard setup invoice once'
);

select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_sotf_zero_trial','invoice.paid',
      'in_sotf_zero','cus_slice_c_sotf','sub_slice_c_sotf','TRIALING',
      null,false,0,false,null,false,true
    )$$,
  array['APPLIED'],
  'The zero-dollar SOTF trial invoice is recorded without qualifying'
);
select is(
  (select sotf_qualifying_paid_cycles from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  0::smallint,
  'A zero-dollar SOTF trial invoice does not increment paid cycles'
);

select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_sotf_failed','invoice.payment_failed',
      'in_sotf_failed','cus_slice_c_sotf','sub_slice_c_sotf','TRIALING',
      null,true,0,false,null,false,true
    )$$,
  array['APPLIED'],
  'A failed SOTF invoice is reconciled without qualifying as paid'
);
select is(
  (select sotf_qualifying_paid_cycles from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  0::smallint,
  'A failed invoice does not increment the SOTF paid-cycle count'
);

select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_sotf_paid_1','invoice.paid',
      'in_sotf_paid_1','cus_slice_c_sotf','sub_slice_c_sotf','ACTIVE',
      null,false,1900,true,null,true,true
    )$$,
  array['APPLIED'],
  'The first valid discounted $19 SOTF recurring invoice is applied'
);
select is(
  (select sotf_qualifying_paid_cycles from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  1::smallint,
  'The first valid SOTF recurring invoice increments count to one'
);
select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_sotf_paid_1','invoice.paid',
      'in_sotf_paid_1','cus_slice_c_sotf','sub_slice_c_sotf','ACTIVE',
      null,false,1900,true,null,true,true
    )$$,
  array['DUPLICATE'],
  'Replaying the first SOTF paid event is a no-op'
);
select is(
  (select sotf_qualifying_paid_cycles from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  1::smallint,
  'SOTF replay cannot increment the count twice'
);

do $$
declare
  i integer;
begin
  for i in 2..12 loop
    perform * from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2',
      'evt_sotf_paid_' || i,
      'invoice.paid',
      'in_sotf_paid_' || i,
      'cus_slice_c_sotf',
      'sub_slice_c_sotf',
      'ACTIVE',
      null,
      false,
      1900,
      true,
      null,
      true,
      true
    );
  end loop;
end;
$$;

select is(
  (select sotf_qualifying_paid_cycles from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  12::smallint,
  'Exactly twelve distinct qualifying SOTF paid invoices produce count 12'
);
select results_eq(
  $$select count(*) from entry_identity.stripe_reconciliation_events
    where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'
      and qualifying_paid_cycle$$,
  array[12::bigint],
  'Each qualifying SOTF invoice is counted exactly once in the event ledger'
);
select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_sotf_thirteenth','invoice.paid',
      'in_sotf_thirteenth','cus_slice_c_sotf','sub_slice_c_sotf','ACTIVE',
      null,false,1900,false,null,true,true
    )$$,
  array['APPLIED'],
  'A later paid invoice is reconciled without a thirteenth qualifying-cycle action'
);
select is(
  (select sotf_qualifying_paid_cycles from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  12::smallint,
  'Slice C performs no discount-removal mutation after count 12'
);

select results_eq(
  $$select resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_failure_first','invoice.payment_failed',
      'in_failure_first','cus_slice_c_standard','sub_slice_c_standard','PAYMENT_GRACE',
      null,true,0,false,'2026-09-20 10:00:00+00',false,true
    )$$,
  array['PAYMENT_GRACE'],
  'The first qualifying renewal failure starts payment grace'
);
select results_eq(
  $$select grace_started_at::text || ':' || grace_until::text
    from entry_identity.personal_billing_accounts
    where canonical_user_id = '00000000-0000-4000-8000-0000000022c1'$$,
  array['2026-09-20 10:00:00+00:2026-09-27 10:00:00+00'],
  'The grace deadline is exactly seven days after the first failure'
);
select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_failure_retry','invoice.payment_failed',
      'in_failure_retry','cus_slice_c_standard','sub_slice_c_standard','PAYMENT_GRACE',
      null,true,0,false,'2026-09-22 10:00:00+00',false,true
    )$$,
  array['APPLIED'],
  'A later Stripe retry failure is recorded'
);
select is(
  (select grace_until from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c1'),
  '2026-09-27 10:00:00+00'::timestamptz,
  'Retry failures do not extend the original grace deadline'
);
select is(
  public.get_effective_entry_billing_state(
    '00000000-0000-4000-8000-0000000022c1',
    '2026-09-27 10:00:00+00'
  ),
  'SUSPENDED_PAYMENT'::entry_identity.personal_billing_state,
  'Grace expiration evaluates as suspended without a new webhook'
);
select results_eq(
  $$select resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_recovery_paid','invoice.paid',
      'in_recovery_paid','cus_slice_c_standard','sub_slice_c_standard','ACTIVE',
      null,false,3900,false,null,true,true
    )$$,
  array['ACTIVE'],
  'A successful recurring payment restores active normalized state'
);
select results_eq(
  $$select count(*) from entry_identity.personal_billing_accounts
    where canonical_user_id = '00000000-0000-4000-8000-0000000022c1'
      and grace_started_at is null and grace_until is null$$,
  array[1::bigint],
  'Successful payment clears both grace timestamps'
);

select results_eq(
  $$select resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_pause','customer.subscription.paused',
      'sub_slice_c_sotf','cus_slice_c_sotf','sub_slice_c_sotf','PAUSED_NO_PAYMENT_METHOD',
      null,true,null,false,null,false,false
    )$$,
  array['PAUSED_NO_PAYMENT_METHOD'],
  'A no-card trial pause normalizes without deleting billing ownership'
);
select results_eq(
  $$select resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_resume','customer.subscription.resumed',
      'sub_slice_c_sotf','cus_slice_c_sotf','sub_slice_c_sotf','ACTIVE',
      null,false,null,false,null,false,false
    )$$,
  array['ACTIVE'],
  'A server-reconciled resume may record current active Stripe truth'
);
select results_eq(
  $$select resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_cancel_scheduled','customer.subscription.updated',
      'sub_slice_c_standard','cus_slice_c_standard','sub_slice_c_standard','CANCEL_AT_PERIOD_END',
      null,null,null,false,null,false,false,'APPLIED',null,true
    )$$,
  array['CANCEL_AT_PERIOD_END'],
  'Cancel-at-period-end remains distinct from canceled'
);
select results_eq(
  $$select resulting_state::text
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c1','evt_deleted','customer.subscription.deleted',
      'sub_slice_c_standard','cus_slice_c_standard','sub_slice_c_standard','CANCELED',
      null,null,null,false,null,false,false,'APPLIED',null,false
    )$$,
  array['CANCELED'],
  'Actual subscription deletion normalizes to canceled'
);
select results_eq(
  $$select application_result
    from pg_temp.apply_event(
      '00000000-0000-4000-8000-0000000022c2','evt_trial_end','customer.subscription.trial_will_end',
      'sub_slice_c_sotf','cus_slice_c_sotf','sub_slice_c_sotf',null,
      null,true,null,false,null,false,false
    )$$,
  array['APPLIED'],
  'Trial-will-end is reconciled without notification infrastructure'
);
select is(
  (select payment_method_required from entry_identity.personal_billing_accounts
   where canonical_user_id = '00000000-0000-4000-8000-0000000022c2'),
  true,
  'Trial-will-end can record that a payment method is required'
);

reset role;
select is(
  (select enabled from entry_identity.billing_cutover_control
   where setting_key = 'phase_2_2_billing_enforcement_enabled'),
  false,
  'Billing cutover remains disabled'
);
select is(
  has_table_privilege('authenticated', 'entry_identity.stripe_reconciliation_events', 'select'),
  false,
  'Raw reconciliation evidence remains private to Entry'
);

select * from finish();
rollback;
