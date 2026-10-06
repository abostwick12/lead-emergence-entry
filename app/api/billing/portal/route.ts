import { NextResponse } from 'next/server';
import { getBillingConfig } from '@/lib/billing/config';
import { createPortalSessionForUser, BillingLifecycleError } from '@/lib/billing/lifecycle';
import { createEntryBillingLifecycleStore } from '@/lib/billing/store';
import { getStripeClient } from '@/lib/billing/stripe';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let config;
  try {
    config = getBillingConfig();
  } catch {
    return NextResponse.json({ error: 'Billing configuration unavailable' }, { status: 503 });
  }
  if (new URL(request.url).origin !== config.entryOrigin
    || request.headers.get('origin') !== config.entryOrigin) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if ((await request.text()).trim() !== '') {
    return NextResponse.json({ error: 'Portal request must not include billing identifiers' }, { status: 400 });
  }

  try {
    const session = await createPortalSessionForUser(data.user.id, {
      stripe: getStripeClient(),
      store: createEntryBillingLifecycleStore(),
      config,
    });
    return NextResponse.redirect(session.url, 303);
  } catch (portalError) {
    if (portalError instanceof BillingLifecycleError) {
      return NextResponse.json({ error: portalError.code }, { status: portalError.status });
    }
    return NextResponse.json({ error: 'Customer Portal unavailable' }, { status: 503 });
  }
}
