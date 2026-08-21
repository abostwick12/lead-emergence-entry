import { NextResponse } from 'next/server';
import { safeEntryReturnPath } from '@/lib/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const origin = process.env.APP_ORIGIN;
  const destination = safeEntryReturnPath(url.searchParams.get('next'));
  if (!code || !origin) return NextResponse.redirect(new URL('/login?error=invalid_callback', origin ?? url.origin));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL('/login?error=invalid_callback', origin));
  return NextResponse.redirect(new URL(destination, origin));
}
