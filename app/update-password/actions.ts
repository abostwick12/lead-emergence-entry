'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const passwordSchema = z.object({ password: z.string().min(12).max(128) });

export async function updateRecoveredPassword(formData: FormData) {
  const parsed = passwordSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) redirect('/update-password?error=invalid_password');
  const supabase = await createSupabaseServerClient();
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) redirect('/login?error=recovery_session_expired');
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect('/update-password?error=unavailable');
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login?message=password_updated');
}
