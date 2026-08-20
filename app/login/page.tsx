import Link from 'next/link';
import { signIn } from './actions';

export default function LoginPage() {
  return <main><div className="shell" style={{padding:'48px 0'}}><Link href="/" className="eyebrow">Lead Emergence</Link><section style={{maxWidth:460,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Welcome back</p><h1 className="serif" style={{fontSize:'3rem',fontWeight:400}}>Sign in</h1><form action={signIn} style={{display:'grid',gap:18}}><label>Email<input name="email" type="email" autoComplete="email" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><label>Password<input name="password" type="password" autoComplete="current-password" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><button className="button" type="submit">Sign in</button></form><p>New to Lead Emergence? <Link href="/signup">Create an account</Link></p></section></div></main>;
}
