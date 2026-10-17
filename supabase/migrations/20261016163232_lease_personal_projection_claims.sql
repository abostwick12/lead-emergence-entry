-- Keep a claimed PENDING delivery unavailable to another drain until it is
-- explicitly failed or its lease expires. Preserve the same delivery_id on retry.
create or replace function public.claim_entry_personal_projection_batch(
  p_limit integer default 10
) returns table(
  delivery_id uuid,
  projection_kind entry_identity.personal_projection_kind,
  projection_version bigint,
  canonical_user_id uuid,
  projected_at timestamptz,
  projection_data jsonb,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if p_limit not between 1 and 25 then
    raise exception 'Projection batch size must be between 1 and 25.' using errcode = '22023';
  end if;

  return query
  with pending as (
    select outbox.projection_version
    from entry_identity.personal_projection_outbox as outbox
    where outbox.delivery_state = 'PENDING'
      and (
        outbox.last_attempt_at is null
        or outbox.last_error is not null
        or outbox.last_attempt_at < now() - interval '5 minutes'
      )
    order by outbox.projection_version
    limit p_limit
    for update skip locked
  ), claimed as (
    update entry_identity.personal_projection_outbox as outbox
    set attempts = outbox.attempts + 1,
        last_attempt_at = now(),
        last_error = null
    from pending
    where outbox.projection_version = pending.projection_version
    returning outbox.*
  )
  select
    claimed.delivery_id,
    claimed.projection_kind,
    claimed.projection_version,
    claimed.canonical_user_id,
    claimed.created_at,
    claimed.projection_data,
    claimed.attempts
  from claimed
  order by claimed.projection_version;
end;
$$;

-- A result from an expired claim must not update a newer claim of the same
-- delivery. Replace the old callable signature so the attempt is required.
drop function public.mark_entry_personal_projection_delivery(uuid, boolean, text);

create function public.mark_entry_personal_projection_delivery(
  p_delivery_id uuid,
  p_expected_attempt integer,
  p_delivered boolean,
  p_sanitized_error text default null
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error text := nullif(left(btrim(coalesce(p_sanitized_error, '')), 200), '');
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'Trusted Entry server identity is required.' using errcode = '42501';
  end if;
  if p_expected_attempt is null or p_expected_attempt < 1 then
    raise exception 'A claimed projection attempt is required.' using errcode = '22023';
  end if;
  if not p_delivered and v_error is null then
    raise exception 'A sanitized delivery error is required.' using errcode = '22023';
  end if;

  update entry_identity.personal_projection_outbox as outbox
  set delivery_state = (
        case when p_delivered then 'DELIVERED' else 'PENDING' end
      )::entry_identity.personal_projection_delivery_state,
      delivered_at = case when p_delivered then coalesce(outbox.delivered_at, now()) else null end,
      last_error = case when p_delivered then null else v_error end
  where outbox.delivery_id = p_delivery_id
    and outbox.attempts = p_expected_attempt
    and outbox.delivery_state = 'PENDING';
  return found;
end;
$$;

revoke all on function public.mark_entry_personal_projection_delivery(uuid, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.mark_entry_personal_projection_delivery(uuid, integer, boolean, text)
  to service_role;
