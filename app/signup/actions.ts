'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const signupSchema = z.object({ name: z.string().trim().min(2), email: z.string().email(), password: z.string().min(8) });

export async function signUp(formData: FormData) {
  const parsed = signupSchema.safeParse({ name: formData.get('name'), email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) redirect('/signup?error=invalid_details');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { data: { display_name: parsed.data.name }, emailRedirectTo: `${process.env.APP_ORIGIN}/auth/callback` } });
  if (error) redirect('/signup?error=unable_to_create');
  redirect('/login?message=check_email');
}