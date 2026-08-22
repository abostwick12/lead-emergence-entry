-- Keep Supabase's automatic RLS event trigger internal. Event triggers do not
-- require SQL EXECUTE grants, and neither browser role should be able to call
-- its SECURITY DEFINER function through the Data API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- Cover identity foreign keys used for revocation, audit, and cleanup paths.
create index if not exists identity_audit_events_canonical_user_id_idx
  on entry_identity.identity_audit_events(canonical_user_id);

create index if not exists product_entitlements_granted_by_idx
  on entry_identity.product_entitlements(granted_by)
  where granted_by is not null;

create index if not exists product_handoff_nonces_canonical_user_id_idx
  on entry_identity.product_handoff_nonces(canonical_user_id);

create index if not exists product_identity_links_canonical_user_id_idx
  on entry_identity.product_identity_links(canonical_user_id);
