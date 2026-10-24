begin;
select plan(19);

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

select is(has_function_privilege('authenticated', 'public.apply_entry_stripe_reconciliation(uuid,text,text,text,timestamptz,text,text,text,entry_identity.personal_billing_state,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,boolean,integer,boolean,timestamptz,boolean,boolean,text)', 'execute'), false, 'Authenticated users cannot reconcile billing');
select is(has_function_privilege('anon', 'public.apply_entry_stripe_reconciliation(uuid,text,text,text,timestamptz,text,text,text,entry_identity.personal_billing_state,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,boolean,integer,boolean,timestamptz,boolean,boolean,text)', 'execute'), false, 'Anonymous users cannot reconcile billing');
select is(has_function_privilege('service_role', 'public.apply_entry_stripe_reconciliation(uuid,text,text,text,timestamptz,text,text,text,entry_identity.personal_billing_state,timestamptz,boolean,timestamptz,timestamptz,timestamptz,timestamptz,boolean,integer,boolean,timestamptz,boolean,boolean,text)', 'execute'), true, 'The existing service role can reconcile billing');

insert into auth.users(id) select ('00000000-0000-4000-8000-00000000f40' || n)::uuid from generate_series(1,7) n;
insert into entry_identity.personal_billing_accounts(canonical_user_id, selected_offer, stripe_customer_id, stripe_checkout_session_id)
values
  ('00000000-0000-4000-8000-00000000f401', 'STANDARD_INDIVIDUAL', null, null),
  ('00000000-0000-4000-8000-00000000f402', 'STANDARD_INDIVIDUAL', null, null),
  ('00000000-0000-4000-8000-00000000f403', 'STANDARD_INDIVIDUAL', 'cus_guard_3', null),
  ('00000000-0000-4000-8000-00000000f404', 'STANDARD_INDIVIDUAL', 'cus_guard_4', null),
  ('00000000-0000-4000-8000-00000000f405', 'SOTF_FOUNDING_FELLOW', 'cus_guard_5', 'cs_guard_5'),
  ('00000000-0000-4000-8000-00000000f406', 'SOTF_FOUNDING_FELLOW', 'cus_guard_6', 'cs_guard_6'),
  ('00000000-0000-4000-8000-00000000f407', 'STANDARD_INDIVIDUAL', 'cus_guard_7', null);
create temp table guard_accounts_before as
  select account.canonical_user_id, to_jsonb(account) as state
  from entry_identity.personal_billing_accounts account
  where account.canonical_user_id::text like '00000000-0000-4000-8000-00000000f40%';

set local role service_role;
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f401', 'evt_guard_null_stored_customer', 'customer.subscription.updated', 'sub_guard_1', 'cus_unbound', 'sub_guard_1', p_state => 'ACTIVE')$$, '23503', 'Stripe Customer ownership mismatch.', 'A missing stored customer cannot establish ownership');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f402', 'evt_guard_both_null_customer', 'customer.subscription.updated', 'sub_guard_2', null, 'sub_guard_2', p_state => 'ACTIVE')$$, '23503', 'Stripe Customer ownership mismatch.', 'Two missing customer IDs do not prove ownership');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f403', 'evt_guard_null_incoming_customer', 'customer.subscription.updated', 'sub_guard_3', null, 'sub_guard_3', p_state => 'ACTIVE')$$, '23503', 'Stripe Customer ownership mismatch.', 'A missing incoming customer is rejected');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f404', 'evt_guard_null_stored_checkout', 'checkout.session.completed', 'cs_unbound', 'cus_guard_4', 'sub_guard_4', p_state => 'ACTIVE', p_checkout => 'cs_unbound')$$, '23503', 'Stripe Checkout ownership mismatch.', 'A provided checkout must match a stored checkout');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f405', 'evt_guard_null_amount', 'invoice.paid', 'in_guard_null', 'cus_guard_5', 'sub_guard_5', p_state => 'ACTIVE', p_amount => null, p_qualifying => true, p_logical => true)$$, '22023', 'Invalid SOTF qualifying paid cycle.', 'A qualifying paid cycle requires its exact paid amount');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f406', 'evt_guard_wrong_customer', 'invoice.paid', 'in_guard_wrong_customer', 'cus_wrong', 'sub_guard_6', p_amount => 1900, p_qualifying => true, p_logical => true)$$, '23503', 'Stripe Customer ownership mismatch.', 'Existing non-null customer mismatch rejection remains');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f406', 'evt_guard_wrong_checkout', 'checkout.session.completed', 'cs_wrong', 'cus_guard_6', 'sub_guard_6', p_checkout => 'cs_wrong')$$, '23503', 'Stripe Checkout ownership mismatch.', 'Existing non-null checkout mismatch rejection remains');
select throws_ok($$select * from pg_temp.apply_event('00000000-0000-4000-8000-00000000f406', 'evt_guard_wrong_amount', 'invoice.paid', 'in_guard_wrong_amount', 'cus_guard_6', 'sub_guard_6', p_amount => 1899, p_qualifying => true, p_logical => true)$$, '22023', 'Invalid SOTF qualifying paid cycle.', 'Existing wrong paid-amount rejection remains');
reset role;

select is((select count(*) from entry_identity.stripe_reconciliation_events where stripe_event_id like 'evt_guard_%'), 0::bigint, 'Rejected calls persist no reconciliation event');
select results_eq(
  $$select account.canonical_user_id, to_jsonb(account) from entry_identity.personal_billing_accounts account where account.canonical_user_id::text like '00000000-0000-4000-8000-00000000f40%' order by account.canonical_user_id$$,
  $$select canonical_user_id, state from guard_accounts_before order by canonical_user_id$$,
  'Rejected calls leave every fixture account unchanged'
);

set local role service_role;
select results_eq($$select application_result, resulting_paid_cycles from pg_temp.apply_event('00000000-0000-4000-8000-00000000f407', 'evt_guard_valid_subscription', 'customer.subscription.created', 'sub_guard_7', 'cus_guard_7', 'sub_guard_7', p_state => 'ACTIVE')$$, $$values ('APPLIED'::text, 0::smallint)$$, 'Valid subscription binding permits omitted checkout');
reset role;
select is((select stripe_subscription_id from entry_identity.personal_billing_accounts where canonical_user_id='00000000-0000-4000-8000-00000000f407'), 'sub_guard_7', 'The first verified subscription still binds');
set local role service_role;
select results_eq($$select application_result, resulting_paid_cycles from pg_temp.apply_event('00000000-0000-4000-8000-00000000f406', 'evt_guard_valid_paid', 'invoice.paid', 'in_guard_valid', 'cus_guard_6', 'sub_guard_6', p_state => 'ACTIVE', p_amount => 1900, p_qualifying => true, p_logical => true)$$, $$values ('APPLIED'::text, 1::smallint)$$, 'A valid SOTF invoice still adds one qualifying cycle');
select results_eq($$select application_result, resulting_paid_cycles from pg_temp.apply_event('00000000-0000-4000-8000-00000000f406', 'evt_guard_valid_paid', 'invoice.paid', 'in_guard_valid', 'cus_guard_6', 'sub_guard_6', p_state => 'ACTIVE', p_amount => 1900, p_qualifying => true, p_logical => true)$$, $$values ('DUPLICATE'::text, 1::smallint)$$, 'Replayed event does not add another paid cycle');
select results_eq($$select application_result, resulting_paid_cycles from pg_temp.apply_event('00000000-0000-4000-8000-00000000f406', 'evt_guard_valid_paid_redelivery', 'invoice.paid', 'in_guard_valid', 'cus_guard_6', 'sub_guard_6', p_state => 'ACTIVE', p_amount => 1900, p_qualifying => true, p_logical => true)$$, $$values ('DUPLICATE'::text, 1::smallint)$$, 'Logical-object replay still deduplicates across event IDs');
reset role;
select is((select count(*) from entry_identity.stripe_reconciliation_events where stripe_event_id like 'evt_guard_%'), 2::bigint, 'Only the two valid distinct events remain in the ledger');

select * from finish();
rollback;
