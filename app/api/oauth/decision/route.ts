import { NextResponse } from 'next/server';
import { canAuthorizeProduct, oauthProductForClient, oauthRedirectOrigin } from '@/lib/oauth/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isTrustedOAuthFormOrigin, safeOAuthRedirect } from '@/lib/oauth/contracts';

export async function POST(request: Request) {
  if (!isTrustedOAuthFormOrigin(request.url, request.headers.get('origin'), process.env.APP_ORIGIN)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const form = await request.formData();
  const authorizationId = form.get('authorization_id');
  const decision = form.get('decision');
  if (typeof authorizationId !== 'string' || typeof decision !== 'string' || !['approve', 'deny'].includes(decision)) return NextResponse.json({ error: 'Invalid OAuth decision' }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !details || !('authorization_id' in details)) return NextResponse.json({ error: 'Authorization request unavailable' }, { status: 400 });

  const product = oauthProductForClient(details.client.id);
  const entitled = Boolean(product) && await canAuthorizeProduct(supabase, product!);
  const approve = decision === 'approve' && Boolean(product) && entitled;
  const result = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (result.error || !result.data?.redirect_url) return NextResponse.json({ error: 'OAuth decision could not be completed' }, { status: 400 });
  const destination = product ? safeOAuthRedirect(result.data.redirect_url, oauthRedirectOrigin(product)) : null;
  if (!destination) return NextResponse.json({ error: 'OAuth callback is invalid' }, { status: 400 });
  return NextResponse.redirect(destination, 303);
}
