import { notFound } from 'next/navigation';
import { EntrySignupDirectoryError, loadAuthorizedEntrySignups } from '@/lib/operator/signup-directory';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requestOperatorRecovery } from './actions';

function DirectoryUnavailable() {
  return <main><div className="shell" style={{ padding: '48px 0' }}>
    <section style={{ maxWidth: 760, margin: '12vh auto' }}>
      <p className="eyebrow">Operator</p>
      <h1 className="serif" style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 400 }}>Account directory unavailable</h1>
      <p role="alert" style={{ fontSize: '1.1rem', lineHeight: 1.7 }}>The complete Entry account directory could not be loaded. No partial account list is shown.</p>
    </section>
  </div></main>;
}

export default async function OperatorSignupsPage({ searchParams }: { searchParams?: Promise<{ recovery?: string }> } = {}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) notFound();

  let signups;
  try {
    signups = await loadAuthorizedEntrySignups(user);
  } catch (error) {
    console.error('Entry signup directory load failed', {
      code: error instanceof EntrySignupDirectoryError ? error.code : 'unexpected_error',
    });
    return <DirectoryUnavailable />;
  }
  if (signups === null) notFound();

  return <main><div className="shell" style={{ padding: '48px 0 72px' }}>
    <section style={{ maxWidth: 960, margin: '8vh auto' }}>
      <p className="eyebrow">Operator</p>
      <h1 className="serif" style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 400 }}>Entry signups</h1>
      <p style={{ fontSize: '1.1rem', lineHeight: 1.7 }}>Every account created through Lead Emergence Entry, including internal and test accounts.</p>
      {params?.recovery === 'requested' && <p role="status">A recovery email was requested.</p>}
      {params?.recovery === 'unavailable' && <p role="alert">A recovery email could not be requested.</p>}
      <div style={{ overflowX: 'auto', marginTop: 32 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #d9d1c3' }}>Email</th>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #d9d1c3' }}>Account created</th>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #d9d1c3' }}>Recovery</th>
            </tr>
          </thead>
          <tbody>
            {signups.map((signup, index) => <tr key={`${signup.email ?? 'no-email'}:${signup.created_at}:${index}`}>
              <td style={{ padding: '12px 8px', borderBottom: '1px solid #ebe5db' }}>{signup.email ?? 'No email'}</td>
              <td style={{ padding: '12px 8px', borderBottom: '1px solid #ebe5db' }}><time dateTime={signup.created_at}>{signup.created_at}</time></td>
              <td style={{ padding: '12px 8px', borderBottom: '1px solid #ebe5db' }}>{signup.email && <form action={requestOperatorRecovery}><input type="hidden" name="email" value={signup.email} /><button type="submit">Request recovery email</button></form>}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div></main>;
}
