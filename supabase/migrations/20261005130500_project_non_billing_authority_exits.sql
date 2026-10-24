-- Preserve the existing normalized receiver contract when an entitlement leaves
-- a non-billing authority. Workspace retains a separate row for each authority.
-- Forward-only: no historical migration, RPC signature or privilege changes.
create or replace function entry_identity.enqueue_personal_access_authority_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new_projectable boolean;
begin
  if new.product <> 'PERSONAL' then
    return new;
  end if;

  v_new_projectable := coalesce(
    new.authority_kind::text in ('SPONSORED_ACCESS', 'INTERNAL_OPERATOR')
      and new.status in ('ACTIVE', 'SUSPENDED', 'REVOKED'),
    false
  );

  if tg_op = 'UPDATE' then
    if new.authority_kind is not distinct from old.authority_kind
      and new.status is not distinct from old.status
      and new.source is not distinct from old.source
    then
      return new;
    end if;

    if old.product = 'PERSONAL'
      and old.authority_kind::text in ('SPONSORED_ACCESS', 'INTERNAL_OPERATOR')
      and old.status in ('ACTIVE', 'SUSPENDED', 'REVOKED')
      and (not v_new_projectable or new.authority_kind is distinct from old.authority_kind)
    then
      -- Revoke the old authority key; projecting only NEW would leave it active.
      insert into entry_identity.personal_projection_outbox (
        canonical_user_id, projection_kind, projection_data
      ) values (
        new.canonical_user_id,
        'NON_BILLING_AUTHORITY',
        jsonb_build_object(
          'authority_kind', old.authority_kind,
          'entitlement_status', 'REVOKED',
          'source', new.source
        )
      );
    end if;
  end if;

  if v_new_projectable then
    insert into entry_identity.personal_projection_outbox (
      canonical_user_id, projection_kind, projection_data
    ) values (
      new.canonical_user_id,
      'NON_BILLING_AUTHORITY',
      jsonb_build_object(
        'authority_kind', new.authority_kind,
        'entitlement_status', new.status,
        'source', new.source
      )
    );
  end if;
  return new;
end;
$$;
