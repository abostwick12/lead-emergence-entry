import Link from 'next/link';
import { signIn } from './actions';
import { safeEntryReturnPath } from '@/lib/navigation';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; message?: string }> }) {
  const params = await searchParams;
  const next = safeEntryReturnPath(params.next);
  const message = params.message === 'check_email'
    ? 'Check your email to finish creating your account.'
    : params.message === 'password_updated'
      ? 'Your password has been updated. Sign in to continue.'
      : null;
  return <main><div className="shell" style={{padding:'48px 0'}}><Link href="/" className="eyebrow">Lead Emergence</Link><section style={{maxWidth:460,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Welcome back</p><h1 className="serif" style={{fontSize:'3rem',fontWeight:400}}>Sign in</h1>{params.error && <p role="alert">Sign-in could not be completed. Check your details and try again.</p>}{message && <p role="status">{message}</p>}<form action={signIn} style={{display:'grid',gap:18}}><input name="next" type="hidden" value={next} /><label>Email<input name="email" type="email" autoComplete="email" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><label>Password<input name="password" type="password" autoComplete="current-password" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><button className="button" type="submit">Sign in</button></form><p><Link href="/forgot-password">Forgot your password?</Link></p><p>New to Lead Emergence? <Link href="/signup">Create an account</Link></p></section></div></main>;
}
