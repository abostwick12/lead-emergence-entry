-- Entry owns cross-product eligibility. This public RPC is the narrow server
-- command for administering that eligibility; product applications never use
-- it to create their own local roles, memberships, or visibility.

grant select, insert, update on entry_identity.identity_profiles to service_role;
grant select, insert, update on entry_identity.product_entitlements to service_role;
grant insert on entry_identity.identity_audit_events to service_role;

create or replace function public.set_entry_product_entitlement(
  p_canonical_user_id uuid,
  p_product entry_identity.entry_product,
  p_status entry_identity.entitlement_status,
  p_source text,
  p_display_name text default null
) returns table(entitlement_id uuid, effective_status entry_identity.entitlement_status)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entitlement_id uuid;
  v_source text := btrim(coalesce(p_source, ''));
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if char_length(v_source) not between 1 and 120 then
    raise exception 'A concise entitlement source is required.' using errcode = '22023';
  end if;

  if p_display_name is not null and btrim(p_display_name) <> '' then
    insert into entry_identity.identity_profiles(canonical_user_id, display_name)
    values (p_canonical_user_id, left(btrim(p_display_name), 200))
    on conflict (canonical_user_id) do update
      set display_name = excluded.display_name,
          updated_at = now();
  end if;

  insert into entry_identity.product_entitlements(
    canonical_user_id, product, status, granted_at, revoked_at, granted_by, source
  ) values (
    p_canonical_user_id,
    p_product,
    p_status,
    case when p_status = 'ACTIVE' then now() else null end,
    case when p_status = 'REVOKED' then now() else null end,
    p_canonical_user_id,
    v_source
  )
  on conflict (canonical_user_id, product) do update
    set status = excluded.status,
        granted_at = case
          when excluded.status = 'ACTIVE' then coalesce(entry_identity.product_entitlements.granted_at, now())
          else entry_identity.product_entitlements.granted_at
        end,
        revoked_at = case when excluded.status = 'REVOKED' then now() else null end,
        granted_by = excluded.granted_by,
        source = excluded.source,
        updated_at = now()
  returning id into v_entitlement_id;

  insert into entry_identity.identity_audit_events(
    canonical_user_id, event_type, product, metadata
  ) values (
    p_canonical_user_id,
    'ENTRY_PRODUCT_ENTITLEMENT_SET',
    p_product,
    jsonb_build_object('status', p_status, 'source', v_source)
  );

  return query select v_entitlement_id, p_status;
end;
$$;

revoke all on function public.set_entry_product_entitlement(
  uuid, entry_identity.entry_product, entry_identity.entitlement_status, text, text
) from public, anon, authenticated;
grant execute on function public.set_entry_product_entitlement(
  uuid, entry_identity.entry_product, entry_identity.entitlement_status, text, text
) to service_role;

comment on function public.set_entry_product_entitlement(
  uuid, entry_identity.entry_product, entry_identity.entitlement_status, text, text
) is 'Service-only, audited Entry command for global product eligibility; it creates no product-local authorization.';
