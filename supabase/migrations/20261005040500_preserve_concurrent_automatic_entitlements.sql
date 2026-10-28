-- Forward repair for automatic PERSONAL provisioning.
-- Preserve the existing RPC signature, grants and explicit administration.
-- No backfill, customer entitlement change or new database object.

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
  v_authority_kind entry_identity.entitlement_authority_kind;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if char_length(v_source) not between 1 and 120 then
    raise exception 'A concise entitlement source is required.' using errcode = '22023';
  end if;

  if v_source = 'sotf_founding_fellow_2026' then
    if p_product <> 'PERSONAL' or p_status <> 'PENDING' then
      raise exception 'SOTF offer eligibility must be a pending Personal entitlement.' using errcode = '22023';
    end if;
    v_authority_kind := 'OFFER_ELIGIBILITY';
  elsif v_source = 'phase_2_1_prebilling_automatic_personal' then
    v_authority_kind := 'LEGACY_PREBILLING';
  elsif v_source = 'family_comp_2026' then
    if p_product <> 'PERSONAL'
      or p_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED')
    then
      raise exception 'Sponsored access must use the Personal entitlement lifecycle.' using errcode = '22023';
    end if;
    v_authority_kind := 'SPONSORED_ACCESS'::text::entry_identity.entitlement_authority_kind;
  end if;

  if p_display_name is not null and btrim(p_display_name) <> '' then
    insert into entry_identity.identity_profiles(canonical_user_id, display_name)
    values (p_canonical_user_id, left(btrim(p_display_name), 200))
    on conflict (canonical_user_id) do update
      set display_name = excluded.display_name,
          updated_at = now();
  end if;

  insert into entry_identity.product_entitlements(
    canonical_user_id, product, status, granted_at, revoked_at, granted_by, source, authority_kind
  ) values (
    p_canonical_user_id,
    p_product,
    p_status,
    case when p_status = 'ACTIVE' then now() else null end,
    case when p_status = 'REVOKED' then now() else null end,
    p_canonical_user_id,
    v_source,
    v_authority_kind
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
        authority_kind = coalesce(excluded.authority_kind, entry_identity.product_entitlements.authority_kind),
        updated_at = now()
  where v_source <> 'phase_2_1_prebilling_automatic_personal'
  returning id into v_entitlement_id;

  if not found then
    -- A concurrent explicit entitlement wins over automatic provisioning.
    -- Return its current status without changing its authority or audit trail.
    return query
      select entitlement.id, entitlement.status
      from entry_identity.product_entitlements as entitlement
      where entitlement.canonical_user_id = p_canonical_user_id
        and entitlement.product = p_product;
    return;
  end if;

  insert into entry_identity.identity_audit_events(
    canonical_user_id, event_type, product, metadata
  ) values (
    p_canonical_user_id,
    'ENTRY_PRODUCT_ENTITLEMENT_SET',
    p_product,
    jsonb_build_object(
      'status', p_status,
      'source', v_source,
      'authority_kind', v_authority_kind
    )
  );

  return query select v_entitlement_id, p_status;
end;
$$;
