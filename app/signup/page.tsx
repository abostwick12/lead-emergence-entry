import Link from 'next/link';
import { signUp } from './actions';

export default function SignupPage() {
  return <main><div className="shell" style={{padding:'48px 0'}}><Link href="/" className="eyebrow">Lead Emergence</Link><section style={{maxWidth:460,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Begin here</p><h1 className="serif" style={{fontSize:'3rem',fontWeight:400}}>Create your identity</h1><form action={signUp} style={{display:'grid',gap:18}}><label>Name<input name="name" type="text" autoComplete="name" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><label>Email<input name="email" type="email" autoComplete="email" required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><button className="button" type="submit">Create account</button></form><p>Already have an account? <Link href="/login">Sign in</Link></p></section></div></main>;
}
