import Link from 'next/link';
import { updateRecoveredPassword } from './actions';

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return <main><div className="shell" style={{padding:'48px 0'}}><Link href="/" className="eyebrow">Lead Emergence</Link><section style={{maxWidth:460,margin:'12vh auto'}}><p className="eyebrow" style={{color:'var(--teal)'}}>Account recovery</p><h1 className="serif" style={{fontSize:'3rem',fontWeight:400}}>Choose a new password</h1><p>Use at least 12 characters. Completing this step signs out the recovery session.</p>{params.error && <p role="alert">The password could not be updated. Request a new recovery link if this one has expired.</p>}<form action={updateRecoveredPassword} style={{display:'grid',gap:18}}><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required style={{display:'block',width:'100%',padding:14,marginTop:7}} /></label><button className="button" type="submit">Update password</button></form><p><Link href="/forgot-password">Request a new recovery link</Link></p></section></div></main>;
}
