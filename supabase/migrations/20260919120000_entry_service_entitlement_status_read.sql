-- Trusted product services need a narrow status lookup for a known canonical
-- Entry user. Browser callers retain only the self-service active-product read.
create or replace function public.get_entry_product_entitlement_status(
  p_canonical_user_id uuid,
  p_product entry_identity.entry_product
)
returns entry_identity.entitlement_status
language sql
stable
security invoker
set search_path = ''
as $$
  select entitlement.status
  from entry_identity.product_entitlements entitlement
  where entitlement.canonical_user_id = p_canonical_user_id
    and entitlement.product = p_product;
$$;

revoke all on function public.get_entry_product_entitlement_status(
  uuid, entry_identity.entry_product
) from public, anon, authenticated;
grant execute on function public.get_entry_product_entitlement_status(
  uuid, entry_identity.entry_product
) to service_role;

comment on function public.get_entry_product_entitlement_status(
  uuid, entry_identity.entry_product
) is 'Service-only Entry entitlement-status lookup; it creates no product-local authorization.';
