'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function signIn(formData: FormData) {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) redirect('/login?error=invalid_credentials');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect('/login?error=invalid_credentials');
  redirect('/workspaces');
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}