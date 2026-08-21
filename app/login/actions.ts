'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeEntryReturnPath } from '@/lib/navigation';

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function signIn(formData: FormData) {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  const next = safeEntryReturnPath(String(formData.get('next') ?? ''));
  if (!parsed.success) redirect(`/login?error=invalid_credentials&next=${encodeURIComponent(next)}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(`/login?error=invalid_credentials&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}
