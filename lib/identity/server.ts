import 'server-only';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type Product } from '@/lib/identity/products';

export async function requireCanonicalIdentity() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login?next=%2Fworkspaces');
  return { supabase, user };
}

export async function getActiveProducts(userId: string, supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<Product[]> {
  const { data, error } = await supabase.schema('entry_identity').from('product_entitlements').select('product').eq('canonical_user_id', userId).eq('status', 'ACTIVE');
  if (error) throw new Error('Unable to load product access');
  return (data ?? []).map((row) => row.product as Product);
}
