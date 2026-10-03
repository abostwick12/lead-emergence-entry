import { NextResponse } from 'next/server';
import { getBillingConfig } from '@/lib/billing/config';
import { resumeSotfSubscriptionForUser, BillingLifecycleError } from '@/lib/billing/lifecycle';
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
    return NextResponse.json({ error: 'Resume request must not include billing identifiers' }, { status: 400 });
  }

  try {
    const result = await resumeSotfSubscriptionForUser(data.user.id, {
      stripe: getStripeClient(),
      store: createEntryBillingLifecycleStore(),
      config,
    });
    const resumeStatus = result.disposition === 'ALREADY_RESUMED' ? 'already-resumed' : 'requested';
    return NextResponse.redirect(`${config.entryOrigin}/account?resume=${resumeStatus}`, 303);
  } catch (resumeError) {
    if (resumeError instanceof BillingLifecycleError) {
      return NextResponse.json({ error: resumeError.code }, { status: resumeError.status });
    }
    return NextResponse.json({ error: 'Subscription resume unavailable' }, { status: 503 });
  }
}
