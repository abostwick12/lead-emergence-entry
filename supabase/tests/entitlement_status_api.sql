begin;
select plan(8);

select has_function(
  'public',
  'get_entry_product_entitlement_status',
  array['uuid', 'entry_identity.entry_product'],
  'Entry exposes a service-only entitlement-status query'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_entry_product_entitlement_status(uuid,entry_identity.entry_product)',
    'EXECUTE'
  ),
  'The trusted server role may read an entitlement status'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_entry_product_entitlement_status(uuid,entry_identity.entry_product)',
    'EXECUTE'
  ),
  'Authenticated users cannot invoke the server status query'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_entry_product_entitlement_status(uuid,entry_identity.entry_product)',
    'EXECUTE'
  ),
  'Anonymous callers cannot invoke the server status query'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.get_entry_product_entitlement_status(uuid,entry_identity.entry_product)'::regprocedure),
  'The status query has an empty search path'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-0000000000f1','authenticated','authenticated','entry-status-test@example.invalid',now(),'{}',now(),now());
insert into entry_identity.product_entitlements(canonical_user_id,product,status)
values ('00000000-0000-4000-8000-0000000000f1','CONSULTING','SUSPENDED');

set local role service_role;
select results_eq(
  $$select public.get_entry_product_entitlement_status('00000000-0000-4000-8000-0000000000f1','CONSULTING')::text$$,
  array['SUSPENDED'],
  'The trusted server receives the exact non-active entitlement status'
);
select ok(
  public.get_entry_product_entitlement_status('00000000-0000-4000-8000-0000000000f1','MINISTRY') is null,
  'The trusted server receives no status when the entitlement is absent'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select public.get_entry_product_entitlement_status('00000000-0000-4000-8000-0000000000f1','CONSULTING')$$,
  '42501',
  null,
  'An authenticated caller cannot invoke the server status query'
);
reset role;

select * from finish();
rollback;
