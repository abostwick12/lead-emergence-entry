'use server';

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isEntrySignupReader, loadAuthorizedEntrySignups } from '@/lib/operator/signup-directory';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const requestSchema = z.object({ email: z.string().trim().email().max(320) });

export async function requestOperatorRecovery(formData: FormData) {
  const operatorClient = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await operatorClient.auth.getUser();
  if (userError || !isEntrySignupReader(user)) notFound();

  const parsed = requestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) redirect('/operator/signups?recovery=unavailable');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const origin = process.env.APP_ORIGIN?.trim();
  if (!url || !publishableKey || !origin) redirect('/operator/signups?recovery=unavailable');

  let outcome: 'requested' | 'unavailable' = 'unavailable';
  try {
    // Resolve the submitted email against a fresh, complete Entry Auth listing.
    const directory = await loadAuthorizedEntrySignups(user);
    const matches = directory?.filter((entry) => entry.email?.toLowerCase() === parsed.data.email.toLowerCase()) ?? [];
    if (matches.length === 1) {
      // No cookie adapter: sending recovery mail must not replace the operator session.
      const deliveryClient = createClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      });
      const { error } = await deliveryClient.auth.resetPasswordForEmail(matches[0].email!, {
        redirectTo: new URL('/auth/callback?next=%2Fupdate-password', origin).toString(),
      });
      if (error) {
        console.error('Operator recovery request rejected', { code: error.code, status: error.status });
      } else {
        outcome = 'requested';
      }
    }
  } catch {
    // Do not log submitted email, provider messages, or recovery credentials.
    console.error('Operator recovery request failed');
  }

  redirect(`/operator/signups?recovery=${outcome}`);
}
