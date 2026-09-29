import { NextResponse } from 'next/server';
import { checkoutRequestSchema, createCheckoutForUser, BillingCheckoutError } from '@/lib/billing/checkout';
import { getBillingConfig, getEntryOrigin } from '@/lib/billing/config';
import { createEntryBillingStore } from '@/lib/billing/store';
import { getStripeClient } from '@/lib/billing/stripe';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  let entryOrigin: string;
  try {
    entryOrigin = getEntryOrigin();
  } catch {
    return NextResponse.json({ error: 'Billing configuration unavailable' }, { status: 503 });
  }
  if (new URL(request.url).origin !== entryOrigin
    || request.headers.get('origin') !== entryOrigin) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let parsed: ReturnType<typeof checkoutRequestSchema.safeParse>;
  try {
    parsed = checkoutRequestSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid Checkout request' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Checkout request' }, { status: 400 });
  }

  try {
    const checkout = await createCheckoutForUser(
      { id: data.user.id, email: data.user.email },
      parsed.data.offer,
      {
        stripe: getStripeClient(),
        store: createEntryBillingStore(),
        config: getBillingConfig(),
      },
    );
    return NextResponse.json(checkout);
  } catch (checkoutError) {
    if (checkoutError instanceof BillingCheckoutError) {
      return NextResponse.json({ error: checkoutError.code }, { status: checkoutError.status });
    }
    return NextResponse.json({ error: 'Checkout unavailable' }, { status: 503 });
  }
}
