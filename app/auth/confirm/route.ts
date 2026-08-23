import { NextResponse } from 'next/server';
import { emailOtpDestination, safeEmailOtpType } from '@/lib/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = safeEmailOtpType(url.searchParams.get('type'));
  const origin = process.env.APP_ORIGIN;

  if (!tokenHash || !type || !origin) {
    return NextResponse.redirect(new URL('/login?error=invalid_callback', origin ?? url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return NextResponse.redirect(new URL('/login?error=invalid_callback', origin));

  const destination = emailOtpDestination(type, url.searchParams.get('next'));
  return NextResponse.redirect(new URL(destination, origin));
}
