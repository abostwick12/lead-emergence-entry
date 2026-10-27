-- Claim at most the oldest pending delivery for each canonical user. A failed,
-- leased, or concurrently locked predecessor keeps later versions in order.
-- Other users retain the existing least-recently-attempted priority.
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
  with oldest_pending as materialized (
    select outbox.canonical_user_id, min(outbox.projection_version) as projection_version
    from entry_identity.personal_projection_outbox as outbox
    where outbox.delivery_state = 'PENDING'
    group by outbox.canonical_user_id
  ), pending as (
    select outbox.projection_version
    from entry_identity.personal_projection_outbox as outbox
    join oldest_pending as oldest
      on oldest.canonical_user_id = outbox.canonical_user_id
      and oldest.projection_version = outbox.projection_version
    where outbox.delivery_state = 'PENDING'
      and (
        outbox.last_attempt_at is null
        or outbox.last_error is not null
        or outbox.last_attempt_at < now() - interval '5 minutes'
      )
    order by coalesce(outbox.last_attempt_at, outbox.created_at),
      outbox.attempts, outbox.projection_version
    limit p_limit
    for update of outbox skip locked
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
