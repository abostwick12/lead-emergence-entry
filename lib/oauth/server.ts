import 'server-only';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveProducts } from '@/lib/identity/server';
import { productUrl } from '@/lib/handoff/claims';
import { productOAuthStartUrl, uniqueConfiguredProduct, uniqueOAuthRedirectProduct } from '@/lib/oauth/contracts';
import type { Product } from '@/lib/identity/products';

export type OAuthProduct = Extract<Product, 'PERSONAL' | 'CONSULTING'>;

function clientId(product: OAuthProduct) {
  return product === 'PERSONAL' ? process.env.ENTRY_PERSONAL_OAUTH_CLIENT_ID : process.env.ENTRY_CONSULTING_OAUTH_CLIENT_ID;
}

export function oauthRedirectOrigin(product: OAuthProduct) {
  return product === 'PERSONAL' ? process.env.ENTRY_PERSONAL_OAUTH_REDIRECT_ORIGIN : process.env.ENTRY_CONSULTING_OAUTH_REDIRECT_ORIGIN;
}

export function oauthProductForClient(candidate: string): OAuthProduct | null {
  return uniqueConfiguredProduct(candidate, ['PERSONAL', 'CONSULTING'] as const, clientId);
}

export function oauthProductForRedirect(candidate: string): OAuthProduct | null {
  return uniqueOAuthRedirectProduct(candidate, ['PERSONAL', 'CONSULTING'] as const, oauthRedirectOrigin);
}

export async function requireOAuthEntryUser(authorizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent(safeOAuthContinuation(authorizationId))}`);
  return { supabase, user: data.user };
}

export async function canAuthorizeProduct(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, product: OAuthProduct) {
  const products = await getActiveProducts(supabase);
  return products.includes(product);
}

export async function createProductOAuthStart(product: OAuthProduct) {
  const { supabase } = await requireOAuthEntryUserForProduct(product);
  if (!await canAuthorizeProduct(supabase, product)) return null;
  return productOAuthStartUrl(productUrl(product));
}

async function requireOAuthEntryUserForProduct(product: OAuthProduct) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent(`/handoff/${product.toLowerCase()}`)}`);
  return { supabase, user: data.user };
}

export function safeOAuthContinuation(authorizationId: string) {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}
