begin;
select plan(6);

select has_function('public','get_my_active_entry_products',array[]::text[],'Entry exposes a narrow self-service product query');
select ok(has_function_privilege('authenticated','public.get_my_active_entry_products()','EXECUTE'),'Authenticated users may query only their own eligibility');
select ok(not has_function_privilege('anon','public.get_my_active_entry_products()','EXECUTE'),'Anonymous callers cannot query eligibility');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid='public.get_my_active_entry_products()'::regprocedure),
  'The query function has an empty search path'
);

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-0000000000e1','authenticated','authenticated','entry-read-a@example.invalid',now(),'{}',now(),now()),
('00000000-0000-4000-8000-0000000000e2','authenticated','authenticated','entry-read-b@example.invalid',now(),'{}',now(),now());
insert into entry_identity.product_entitlements(canonical_user_id,product,status,granted_at) values
('00000000-0000-4000-8000-0000000000e1','CONSULTING','ACTIVE',now()),
('00000000-0000-4000-8000-0000000000e1','PERSONAL','SUSPENDED',null),
('00000000-0000-4000-8000-0000000000e2','MINISTRY','ACTIVE',now());

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}',true);
select results_eq(
  $$select product::text from public.get_my_active_entry_products()$$,
  array['CONSULTING'],
  'User A receives only their own active product'
);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}',true);
select results_eq(
  $$select product::text from public.get_my_active_entry_products()$$,
  array['MINISTRY'],
  'User B cannot inherit User A eligibility'
);
reset role;

select * from finish();
rollback;
