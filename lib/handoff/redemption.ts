import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const redemptionRequestSchema = z.object({
  jti: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  product: z.literal('CONSULTING'),
}).strict();

export async function redeemConsultingNonce(input: unknown) {
  const request = redemptionRequestSchema.parse(input);
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is not configured');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { schema: 'entry_identity' },
  });
  const { data, error } = await supabase.rpc('redeem_handoff_nonce', {
    p_jti: request.jti,
    p_product: request.product,
    p_canonical_user_id: request.canonical_user_id,
  });
  if (error) throw new Error('Nonce redemption failed');
  return data === true;
}