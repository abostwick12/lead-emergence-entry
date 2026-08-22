import { redirect } from 'next/navigation';
import { canAuthorizeConsulting, EXPECTED_CONSULTING_CLIENT_ID, requireOAuthEntryUser, safeOAuthContinuation } from '@/lib/oauth/server';
import { safeOAuthRedirect } from '@/lib/oauth/contracts';

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const authorizationId = (await searchParams).authorization_id;
  if (!authorizationId) return <main><div className="shell"><h1 className="serif">Unable to continue</h1><p>This authorization request is incomplete.</p></div></main>;

  const { supabase } = await requireOAuthEntryUser(authorizationId);
  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !details) return <main><div className="shell"><h1 className="serif">Unable to continue</h1><p>This authorization request is no longer available.</p></div></main>;
  if (!('authorization_id' in details)) {
    const destination = safeOAuthRedirect(details.redirect_url);
    if (!destination || !await canAuthorizeConsulting(supabase)) {
      return <main><div className="shell"><h1 className="serif">Consulting is unavailable</h1><p>This account cannot continue to Consulting.</p></div></main>;
    }
    redirect(destination.toString());
  }

  const clientAllowed = Boolean(EXPECTED_CONSULTING_CLIENT_ID) && details.client.id === EXPECTED_CONSULTING_CLIENT_ID;
  const entitled = clientAllowed && await canAuthorizeConsulting(supabase);
  return <main><div className="shell" style={{padding:'48px 0'}}><section style={{maxWidth:560,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Lead Emergence</p><h1 className="serif" style={{fontSize:'clamp(2.4rem, 6vw, 4.5rem)',fontWeight:400}}>Continue to Consulting</h1><p style={{fontSize:'1.1rem',lineHeight:1.7}}>You&apos;re continuing to Lead Emergence Consulting with your Lead Emergence account.</p><p style={{lineHeight:1.7}}>Consulting will use your Lead Emergence identity and basic profile to recognize your account. Consulting permissions remain managed by Consulting.</p>{!clientAllowed && <p role="alert">This application is not approved for this development environment.</p>}{clientAllowed && !entitled && <p role="alert">Consulting is not currently available for this account.</p>}<form action="/api/oauth/decision" method="post" style={{display:'flex',gap:12,marginTop:28}}><input type="hidden" name="authorization_id" value={authorizationId}/><button className="button" name="decision" value={entitled ? 'approve' : 'deny'} type="submit">{entitled ? 'Continue' : 'Return'}</button><button className="button secondary" name="decision" value="deny" type="submit">Cancel</button></form><p style={{marginTop:24,fontSize:'.85rem'}}>Requested identity sharing: {(details.scope ?? 'openid email profile').split(' ').join(', ')}</p><p><a href={safeOAuthContinuation(authorizationId)}>Return to authorization</a></p></section></div></main>;
}
