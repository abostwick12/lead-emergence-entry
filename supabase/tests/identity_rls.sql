select plan(26);

-- Schema and policy posture.
select ok((select relrowsecurity from pg_class where oid = 'entry_identity.identity_profiles'::regclass), 'profile RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'entry_identity.product_entitlements'::regclass), 'entitlement RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'entry_identity.product_identity_links'::regclass), 'identity link RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'entry_identity.product_handoff_nonces'::regclass), 'nonce RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'entry_identity.identity_audit_events'::regclass), 'audit RLS enabled');
select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'entry_identity' and grantee = 'anon'), 'anon has no Entry table grants');
select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'entry_identity' and grantee = 'authenticated' and privilege_type in ('INSERT', 'DELETE')), 'authenticated has no broad mutation grants');
select ok((select proconfig @> array['search_path=entry_identity, pg_catalog'] from pg_proc where oid = 'entry_identity.redeem_handoff_nonce(uuid,entry_identity.entry_product,uuid)'::regprocedure), 'redeemer search_path constrained');
select ok(to_regprocedure('public.rls_auto_enable()') is null or not exists (
  select 1
  from pg_proc p,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = to_regprocedure('public.rls_auto_enable()')
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
), 'PUBLIC cannot execute the automatic RLS event trigger helper');
select ok(to_regprocedure('public.rls_auto_enable()') is null or not has_function_privilege('anon', to_regprocedure('public.rls_auto_enable()'), 'execute'), 'anon cannot execute the automatic RLS event trigger helper');
select ok(to_regprocedure('public.rls_auto_enable()') is null or not has_function_privilege('authenticated', to_regprocedure('public.rls_auto_enable()'), 'execute'), 'authenticated cannot execute the automatic RLS event trigger helper');
select ok(to_regclass('entry_identity.identity_audit_events_canonical_user_id_idx') is not null, 'audit canonical-user foreign key is indexed');
select ok(to_regclass('entry_identity.product_entitlements_granted_by_idx') is not null, 'entitlement grantor foreign key is indexed');
select ok(to_regclass('entry_identity.product_handoff_nonces_canonical_user_id_idx') is not null, 'nonce canonical-user foreign key is indexed');
select ok(to_regclass('entry_identity.product_identity_links_canonical_user_id_idx') is not null, 'identity-link canonical-user foreign key is indexed');

-- Synthetic authenticated identities and fixtures.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
 ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'entry-test-a@example.invalid', now(), '{}'::jsonb, now(), now()),
 ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'entry-test-b@example.invalid', now(), '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into entry_identity.identity_profiles(canonical_user_id, display_name) values
 ('00000000-0000-4000-8000-0000000000a1', 'Test A'), ('00000000-0000-4000-8000-0000000000b1', 'Test B') on conflict do nothing;
insert into entry_identity.product_entitlements(canonical_user_id, product, status, granted_at) values
 ('00000000-0000-4000-8000-0000000000a1', 'CONSULTING', 'ACTIVE', now()), ('00000000-0000-4000-8000-0000000000b1', 'PERSONAL', 'ACTIVE', now()) on conflict do nothing;

-- Execute as User A. RLS must hide User B and reject all direct writes.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select is((select count(*)::int from entry_identity.identity_profiles where canonical_user_id = '00000000-0000-4000-8000-0000000000b1'), 0, 'User A cannot read User B profile');
select is((select count(*)::int from entry_identity.product_entitlements where canonical_user_id = '00000000-0000-4000-8000-0000000000b1'), 0, 'User A cannot read User B entitlements');
select throws_ok($$insert into entry_identity.product_entitlements(canonical_user_id, product, status) values ('00000000-0000-4000-8000-0000000000a1', 'PERSONAL', 'ACTIVE')$$, '42501', null, 'User A cannot INSERT product_entitlements');
select throws_ok($$update entry_identity.product_entitlements set status = 'REVOKED' where canonical_user_id = '00000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'User A cannot UPDATE product_entitlements');
select throws_ok($$delete from entry_identity.product_entitlements where canonical_user_id = '00000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'User A cannot DELETE product_entitlements');
select throws_ok($$insert into entry_identity.product_handoff_nonces(jti, canonical_user_id, product, expires_at) values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'CONSULTING', now()+interval '90 seconds')$$, '42501', null, 'User A cannot mutate handoff nonces directly');
select throws_ok($$insert into entry_identity.identity_audit_events(canonical_user_id, event_type) values ('00000000-0000-4000-8000-0000000000a1', 'FORGED_EVENT')$$, '42501', null, 'User A cannot create arbitrary audit events');

reset role;
commit;
delete from entry_identity.product_handoff_nonces where jti in ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2');
insert into entry_identity.product_handoff_nonces(jti, canonical_user_id, product, expires_at) values
 ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'CONSULTING', now()+interval '90 seconds'),
 ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'CONSULTING', now()-interval '1 second');
select is(coalesce(entry_identity.redeem_handoff_nonce('00000000-0000-4000-8000-0000000000c1', 'CONSULTING', '00000000-0000-4000-8000-0000000000a1'), false), true, 'first nonce redemption succeeds');
select is(coalesce(entry_identity.redeem_handoff_nonce('00000000-0000-4000-8000-0000000000c1', 'CONSULTING', '00000000-0000-4000-8000-0000000000a1'), false), false, 'replay redemption fails atomically');
select is(coalesce(entry_identity.redeem_handoff_nonce('00000000-0000-4000-8000-0000000000c2', 'CONSULTING', '00000000-0000-4000-8000-0000000000a1'), false), false, 'expired nonce redemption fails');
select is(coalesce(entry_identity.redeem_handoff_nonce('00000000-0000-4000-8000-0000000000c1', 'MINISTRY', '00000000-0000-4000-8000-0000000000a1'), false), false, 'wrong audience nonce redemption fails');

select * from finish();
