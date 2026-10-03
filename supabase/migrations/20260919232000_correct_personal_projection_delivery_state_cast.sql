-- Phase 2.2 Slice D bounded forward correction: keep the accepted delivery
-- contract unchanged while making the enum assignment explicit.

create or replace function public.mark_entry_personal_projection_delivery(
  p_delivery_id uuid,
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
    and outbox.delivery_state = 'PENDING';
  return found;
end;
$$;
