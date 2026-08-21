-- Keep Entry's identity schema out of the Data API allow-list. Authenticated
-- applications receive only their own active product names through this RPC.
create or replace function public.get_my_active_entry_products()
returns table(product entry_identity.entry_product)
language sql
stable
security invoker
set search_path = ''
as $$
  select entitlement.product
  from entry_identity.product_entitlements entitlement
  where entitlement.canonical_user_id = (select auth.uid())
    and entitlement.status = 'ACTIVE'
  order by entitlement.product;
$$;

revoke all on function public.get_my_active_entry_products() from public, anon;
grant execute on function public.get_my_active_entry_products() to authenticated, service_role;

comment on function public.get_my_active_entry_products()
  is 'Returns only the current Entry user product eligibility names; product-local authorization is intentionally absent.';
