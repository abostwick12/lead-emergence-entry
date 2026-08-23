'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const requestSchema = z.object({ email: z.string().trim().email().max(320) });

export async function requestPasswordRecovery(formData: FormData) {
  const parsed = requestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) redirect('/forgot-password?error=invalid_email');
  const origin = process.env.APP_ORIGIN;
  if (!origin) redirect('/forgot-password?error=unavailable');

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: new URL('/auth/callback?next=%2Fupdate-password', origin).toString(),
    });

    if (error) {
      console.error('Password recovery request rejected', {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      redirect('/forgot-password?error=unavailable');
    }
  } catch (error) {
    console.error('Password recovery action failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    redirect('/forgot-password?error=unavailable');
  }

  redirect('/forgot-password?sent=1');
}
