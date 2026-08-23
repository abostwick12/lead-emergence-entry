import { redirect } from 'next/navigation';
import { canAuthorizeProduct, oauthProductForClient, oauthProductForRedirect, oauthRedirectOrigin, requireOAuthEntryUser, safeOAuthContinuation } from '@/lib/oauth/server';
import { safeOAuthRedirect } from '@/lib/oauth/contracts';

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const authorizationId = (await searchParams).authorization_id;
  if (!authorizationId) return <main><div className="shell"><h1 className="serif">Unable to continue</h1><p>This authorization request is incomplete.</p></div></main>;

  const { supabase } = await requireOAuthEntryUser(authorizationId);
  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !details) return <main><div className="shell"><h1 className="serif">Unable to continue</h1><p>This authorization request is no longer available.</p></div></main>;
  if (!('authorization_id' in details)) {
    const product = oauthProductForRedirect(details.redirect_url);
    const destination = product ? safeOAuthRedirect(details.redirect_url, oauthRedirectOrigin(product)) : null;
    if (!product || !destination || !await canAuthorizeProduct(supabase, product)) {
      return <main><div className="shell"><h1 className="serif">Product unavailable</h1><p>This account cannot continue to the requested Lead Emergence product.</p></div></main>;
    }
    redirect(destination.toString());
  }

  const product = oauthProductForClient(details.client.id);
  const entitled = Boolean(product) && await canAuthorizeProduct(supabase, product!);
  const productName = product === 'PERSONAL' ? 'Workspace' : product === 'CONSULTING' ? 'Consulting' : 'this product';
  return <main><div className="shell" style={{padding:'48px 0'}}><section style={{maxWidth:560,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Lead Emergence</p><h1 className="serif" style={{fontSize:'clamp(2.4rem, 6vw, 4.5rem)',fontWeight:400}}>Continue to {productName}</h1><p style={{fontSize:'1.1rem',lineHeight:1.7}}>You&apos;re continuing with your Lead Emergence account.</p><p style={{lineHeight:1.7}}>{productName} will use your Lead Emergence identity and basic profile to recognize your account. Product permissions and private records remain managed inside {productName}.</p>{!product && <p role="alert">This application is not approved for this environment.</p>}{product && !entitled && <p role="alert">{productName} is not currently available for this account.</p>}<form action="/api/oauth/decision" method="post" style={{display:'flex',gap:12,marginTop:28}}><input type="hidden" name="authorization_id" value={authorizationId}/><button className="button" name="decision" value={entitled ? 'approve' : 'deny'} type="submit">{entitled ? 'Continue' : 'Return'}</button><button className="button secondary" name="decision" value="deny" type="submit">Cancel</button></form><p style={{marginTop:24,fontSize:'.85rem'}}>Requested identity sharing: {(details.scope ?? 'openid email profile').split(' ').join(', ')}</p><p><a href={safeOAuthContinuation(authorizationId)}>Return to authorization</a></p></section></div></main>;
}
