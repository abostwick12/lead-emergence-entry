import 'server-only';

import { createClient, type User } from '@supabase/supabase-js';
import type { Product } from '@/lib/identity/products';

const AUTOMATIC_PERSONAL_SOURCE = 'phase_2_1_prebilling_automatic_personal';

type VerifiedEntryUser = Pick<User, 'id' | 'email_confirmed_at'>;

export async function ensureAutomaticPersonalEntitlement(
  user: VerifiedEntryUser | null,
  product: Product | null,
): Promise<boolean> {
  if (!user?.email_confirmed_at || product !== 'PERSONAL') return false;

  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is not configured');

  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: status, error: statusError } = await service.rpc(
    'get_entry_product_entitlement_status',
    { p_canonical_user_id: user.id, p_product: 'PERSONAL' },
  );
  if (statusError) throw new Error('PERSONAL entitlement status could not be read');

  if (status === 'ACTIVE') return true;
  if (status !== null) return false;

  const { error: setterError } = await service.rpc('set_entry_product_entitlement', {
    p_canonical_user_id: user.id,
    p_product: 'PERSONAL',
    p_status: 'ACTIVE',
    p_source: AUTOMATIC_PERSONAL_SOURCE,
    p_display_name: null,
  });
  if (setterError) throw new Error('PERSONAL entitlement could not be activated');
  return true;
}
