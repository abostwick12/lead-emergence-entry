import 'server-only';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveProducts } from '@/lib/identity/server';
import { productUrl } from '@/lib/handoff/claims';
import { consultingOAuthStartUrl } from '@/lib/oauth/contracts';

export const EXPECTED_CONSULTING_CLIENT_ID = process.env.ENTRY_CONSULTING_OAUTH_CLIENT_ID;

export async function requireOAuthEntryUser(authorizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent(safeOAuthContinuation(authorizationId))}`);
  return { supabase, user: data.user };
}

export async function canAuthorizeConsulting(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const products = await getActiveProducts(supabase);
  return products.includes('CONSULTING');
}

export async function createConsultingOAuthStart() {
  const { supabase } = await requireOAuthEntryUserForProduct();
  if (!await canAuthorizeConsulting(supabase)) throw new Error('Consulting access unavailable');
  return consultingOAuthStartUrl(productUrl('CONSULTING'));
}

async function requireOAuthEntryUserForProduct() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect('/login?next=%2Fhandoff%2Fconsulting');
  return { supabase, user: data.user };
}

export function safeOAuthContinuation(authorizationId: string) {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}
