import { z } from 'zod';
import { PRODUCTS, type Product } from '@/lib/identity/products';

export const handoffClaimsSchema = z.object({
  iss: z.string().url(),
  sub: z.string().uuid(),
  aud: z.enum(PRODUCTS),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
}).strict();

export type HandoffClaims = z.infer<typeof handoffClaimsSchema>;

export function productUrl(product: Product): string {
  const values: Record<Product, string | undefined> = {
    PERSONAL: process.env.PERSONAL_PRODUCT_URL,
    MINISTRY: process.env.MINISTRY_PRODUCT_URL,
    CONSULTING: process.env.CONSULTING_PRODUCT_URL,
  };
  const value = values[product];
  if (!value) throw new Error(`Missing destination for ${product}`);
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid product destination');
  if (url.username || url.password) throw new Error('Product destination cannot contain credentials');
  return url.toString();
}
