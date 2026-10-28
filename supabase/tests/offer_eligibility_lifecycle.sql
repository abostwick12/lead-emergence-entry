begin;
select plan(24);

select is(has_function_privilege('service_role','public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)','execute'),true,'Existing service_role execution privilege is preserved');
select is(has_function_privilege('authenticated','public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)','execute'),false,'Existing authenticated execution privilege is preserved');
select is(has_function_privilege('anon','public.set_entry_product_entitlement(uuid,entry_identity.entry_product,entry_identity.entitlement_status,text,text)','execute'),false,'Existing anon execution privilege is preserved');

insert into auth.users(id) select ('00000000-0000-4000-8000-00000000f50' || n)::uuid from generate_series(1,7) n;
insert into entry_identity.product_entitlements(canonical_user_id,product,status,source,authority_kind)
select ('00000000-0000-4000-8000-00000000f50' || n)::uuid,'PERSONAL','PENDING','sotf_founding_fellow_2026','OFFER_ELIGIBILITY' from generate_series(1,6) n;
insert into entry_identity.product_entitlements(canonical_user_id,product,status,source,authority_kind,granted_at) values ('00000000-0000-4000-8000-00000000f507','PERSONAL','ACTIVE','family_comp_2026','SPONSORED_ACCESS',now());

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f501','PERSONAL','REVOKED','operator_revocation',null)$$,'Explicit offer revocation succeeds');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f501' and product='PERSONAL'$$,$$values ('REVOKED'::text,null::text,'operator_revocation'::text,true)$$,'Explicit offer revocation succeeds: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f501' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET' and metadata->>'status'='REVOKED' and metadata->>'source'='operator_revocation'),1::bigint,'Explicit offer revocation succeeds: exact matching audit count');

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f502','PERSONAL','SUSPENDED','operator_suspension',null)$$,'Explicit offer suspension succeeds');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f502' and product='PERSONAL'$$,$$values ('SUSPENDED'::text,null::text,'operator_suspension'::text,false)$$,'Explicit offer suspension succeeds: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f502' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET' and metadata->>'status'='SUSPENDED' and metadata->>'source'='operator_suspension'),1::bigint,'Explicit offer suspension succeeds: exact matching audit count');

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f503','PERSONAL','ACTIVE','administrative',null)$$,'Generic activation clears offer-only authority');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f503' and product='PERSONAL'$$,$$values ('ACTIVE'::text,null::text,'administrative'::text,false)$$,'Generic activation clears offer-only authority: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f503' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET' and metadata->>'status'='ACTIVE' and metadata->>'source'='administrative'),1::bigint,'Generic activation clears offer-only authority: exact matching audit count');

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f504','PERSONAL','ACTIVE','family_comp_2026',null)$$,'An explicit sponsored replacement wins');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f504' and product='PERSONAL'$$,$$values ('ACTIVE'::text,'SPONSORED_ACCESS'::text,'family_comp_2026'::text,false)$$,'An explicit sponsored replacement wins: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f504' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET' and metadata->>'status'='ACTIVE' and metadata->>'source'='family_comp_2026'),1::bigint,'An explicit sponsored replacement wins: exact matching audit count');

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f505','PERSONAL','PENDING','administrative',null)$$,'A pending update retains offer eligibility');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f505' and product='PERSONAL'$$,$$values ('PENDING'::text,'OFFER_ELIGIBILITY'::text,'administrative'::text,false)$$,'A pending update retains offer eligibility: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f505' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET' and metadata->>'status'='PENDING' and metadata->>'source'='administrative'),1::bigint,'A pending update retains offer eligibility: exact matching audit count');

set local role service_role;
select results_eq($$select effective_status::text from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f506','PERSONAL','ACTIVE','phase_2_1_prebilling_automatic_personal',null)$$,array['PENDING'],'Automatic provisioning cannot replace explicit eligibility');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f506' and product='PERSONAL'$$,$$values ('PENDING'::text,'OFFER_ELIGIBILITY'::text,'sotf_founding_fellow_2026'::text,false)$$,'Automatic provisioning cannot replace explicit eligibility: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f506' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET'),0::bigint,'Automatic provisioning cannot replace explicit eligibility: exact matching audit count');

set local role service_role;
select lives_ok($$select * from public.set_entry_product_entitlement('00000000-0000-4000-8000-00000000f507','PERSONAL','REVOKED','operator_revocation',null)$$,'Other authority kinds retain their revocation lifecycle');
reset role;
select results_eq($$select status::text,authority_kind::text,source,(revoked_at is not null) from entry_identity.product_entitlements where canonical_user_id='00000000-0000-4000-8000-00000000f507' and product='PERSONAL'$$,$$values ('REVOKED'::text,'SPONSORED_ACCESS'::text,'operator_revocation'::text,true)$$,'Other authority kinds retain their revocation lifecycle: stored status, authority, source and revocation marker');
select is((select count(*) from entry_identity.identity_audit_events where canonical_user_id='00000000-0000-4000-8000-00000000f507' and event_type='ENTRY_PRODUCT_ENTITLEMENT_SET' and metadata->>'status'='REVOKED' and metadata->>'source'='operator_revocation'),1::bigint,'Other authority kinds retain their revocation lifecycle: exact matching audit count');

select * from finish();
rollback;
