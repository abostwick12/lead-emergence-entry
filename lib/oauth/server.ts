import 'server-only';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureAutomaticPersonalEntitlement } from '@/lib/identity/automatic-personal';
import { getActiveProducts } from '@/lib/identity/server';
import { productUrl } from '@/lib/handoff/claims';
import { productOAuthStartUrl, safeExactOAuthRedirect, safeOAuthRedirect, uniqueConfiguredProduct } from '@/lib/oauth/contracts';
import type { Product } from '@/lib/identity/products';

export type OAuthProduct = Extract<Product, 'PERSONAL' | 'CONSULTING'>;
const PREVIEW_CLIENT_ID = '4988caf7-8d41-4d5f-8ed1-9a88841b692a';
const PREVIEW_ENTRY_ORIGIN = 'https://lead-emergence-entry-dev.vercel.app';
const PREVIEW_WORKSPACE_ORIGIN = 'https://lead-emergence-workspace-git-codex-p2-bf4902-emergence-projects.vercel.app';
const PREVIEW_WORKSPACE_CALLBACK = `${PREVIEW_WORKSPACE_ORIGIN}/auth/callback/sign-in`;

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
  const matches = (['PERSONAL', 'CONSULTING'] as const)
    .filter((product) => Boolean(safeProductOAuthRedirect(candidate, product)));
  return matches.length === 1 ? matches[0] : null;
}

export function safeProductOAuthRedirect(value: string, product: OAuthProduct) {
  if (product === 'PERSONAL' && clientId(product) === PREVIEW_CLIENT_ID) {
    if (process.env.APP_ORIGIN !== PREVIEW_ENTRY_ORIGIN
      || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://vnjdubrnmxvmsccxmhst.supabase.co'
      || oauthRedirectOrigin(product) !== PREVIEW_WORKSPACE_ORIGIN) return null;
    return safeExactOAuthRedirect(value, PREVIEW_WORKSPACE_CALLBACK);
  }
  return safeOAuthRedirect(value, oauthRedirectOrigin(product));
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
  const { supabase, user } = await requireOAuthEntryUserForProduct(product);
  if (product === 'PERSONAL') await ensureAutomaticPersonalEntitlement(user, 'PERSONAL');
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
