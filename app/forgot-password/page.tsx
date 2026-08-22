import Link from 'next/link';
import { requestPasswordRecovery } from './actions';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const params = await searchParams;
  return <main><div className="shell" style={{padding:'48px 0'}}><Link href="/" className="eyebrow">Lead Emergence</Link><section style={{maxWidth:460,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Account recovery</p><h1 className="serif" style={{fontSize:'3rem',fontWeight:400}}>Reset your password</h1><p>Enter your account email. If it is eligible for recovery, Lead Emergence will send a secure reset link.</p>{params.error && <p role="alert">Recovery is temporarily unavailable. Check the email address and try again.</p>}{params.sent === '1' && <p role="status">If that account can be recovered, a reset link has been sent.</p>}<form action={requestPasswordRecovery} style={{display:'grid',gap:18}}><label>Email<input name="email" type="email" autoComplete="email" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><button className="button" type="submit">Send reset link</button></form><p><Link href="/login">Return to sign in</Link></p></section></div></main>;
}
