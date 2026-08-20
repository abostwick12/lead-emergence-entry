import 'server-only';
import { randomUUID } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { type Product } from '@/lib/identity/products';
import { productUrl } from '@/lib/handoff/claims';
import { requireCanonicalIdentity, getActiveProducts } from '@/lib/identity/server';

function privateKey() {
  const value = process.env.PRODUCT_HANDOFF_PRIVATE_KEY;
  if (!value) throw new Error('PRODUCT_HANDOFF_PRIVATE_KEY is not configured');
  return importPKCS8(value.replace(/\\n/g, '\n'), 'RS256');
}

export async function createProductHandoff(product: Product): Promise<{ destination: string; token: string }> {
  const { supabase, user } = await requireCanonicalIdentity();
  const products = await getActiveProducts(user.id, supabase);
  if (!products.includes(product)) throw new Error('Product access unavailable');
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + 90) * 1000).toISOString();
  const { error } = await supabase.schema('entry_identity').from('product_handoff_nonces').insert({ jti, canonical_user_id: user.id, product, expires_at: expiresAt });
  if (error) throw new Error('Unable to create handoff');
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error('APP_ORIGIN is not configured');
  const token = await new SignJWT({ iss: origin, sub: user.id, aud: product, iat: now, exp: now + 90, jti }).setProtectedHeader({ alg: 'RS256', kid: process.env.PRODUCT_HANDOFF_KEY_ID ?? 'entry' }).sign(await privateKey());
  return { destination: new URL('/auth/handoff', productUrl(product)).toString(), token };
}
