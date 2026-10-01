create or replace function entry_identity.enqueue_personal_access_authority_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.product <> 'PERSONAL'
    or new.authority_kind is null
    or new.authority_kind::text not in ('SPONSORED_ACCESS', 'INTERNAL_OPERATOR')
    or new.status not in ('ACTIVE', 'SUSPENDED', 'REVOKED')
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.authority_kind is not distinct from old.authority_kind
    and new.status is not distinct from old.status
    and new.source is not distinct from old.source
  then
    return new;
  end if;

  insert into entry_identity.personal_projection_outbox (
    canonical_user_id,
    projection_kind,
    projection_data
  ) values (
    new.canonical_user_id,
    'NON_BILLING_AUTHORITY',
    jsonb_build_object(
      'authority_kind', new.authority_kind,
      'entitlement_status', new.status,
      'source', new.source
    )
  );
  return new;
end;
$$;
