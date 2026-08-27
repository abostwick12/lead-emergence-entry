import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type Product } from '@/lib/identity/products';
import { entryLoginPath } from '@/lib/navigation';

export async function requireCanonicalIdentity(nextPath = '/workspaces') {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(entryLoginPath(nextPath));
  return { supabase, user };
}

export async function getActiveProducts(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<Product[]> {
  const { data, error } = await supabase.rpc('get_my_active_entry_products');
  if (error) throw new Error('Unable to load product access');
  return (data ?? []).map((row: { product: Product }) => row.product);
}
