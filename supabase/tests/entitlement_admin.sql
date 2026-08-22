begin;
select plan(12);

select has_function(
  'public',
  'set_entry_product_entitlement',
  array['uuid','entry_identity.entry_product','entry_identity.entitlement_status','text','text'],
  'Entry exposes one explicit entitlement administration command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)',
    'EXECUTE'
  ),
  'Only the trusted server role receives the command'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)',
    'EXECUTE'
  ),
  'Authenticated users cannot administer entitlements'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-0000000000d1','authenticated','authenticated','entry-admin-test@example.invalid',now(),'{}',now(),now());

set local role authenticated;
select throws_ok(
  $$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-0000000000d1','CONSULTING','ACTIVE','forged','Forged')$$,
  '42501',
  null,
  'An authenticated caller cannot invoke the server command'
);
reset role;

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-0000000000d1','CONSULTING','ACTIVE','acceptance_test','Entry Admin Test')$$,
  'The trusted server can activate an entitlement'
);
reset role;

select results_eq(
  $$select count(*) from entry_identity.identity_profiles where canonical_user_id='00000000-0000-4000-8000-0000000000d1' and display_name='Entry Admin Test'$$,
  array[1::bigint],
  'The command can create the canonical Entry profile'
);
select results_eq(
  $$select status::text || ':' || source from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-0000000000d1' and product='CONSULTING'$$,
  array['ACTIVE:acceptance_test'],
  'Entry alone records active global Consulting eligibility'
);
select results_eq(
  $$select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-0000000000d1' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'$$,
  array[1::bigint],
  'Activation is audited'
);
select results_eq(
  $$select count(*) from entry_identity.product_identity_links where canonical_user_id='00000000-0000-4000-8000-0000000000d1'$$,
  array[0::bigint],
  'Eligibility administration creates no product-local identity link'
);

set local role service_role;
select lives_ok(
  $$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-0000000000d1','CONSULTING','REVOKED','acceptance_test','Entry Admin Test')$$,
  'The trusted server can revoke an entitlement'
);
reset role;

select results_eq(
  $$select count(*) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-0000000000d1' and product='CONSULTING' and status='REVOKED' and revoked_at is not null$$,
  array[1::bigint],
  'Revocation is durable and timestamped'
);
select results_eq(
  $$select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-0000000000d1' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'$$,
  array[2::bigint],
  'Every entitlement transition is audited'
);

select * from finish();
rollback;
