import { notFound } from 'next/navigation';
import { loadAuthorizedEntrySignups } from '@/lib/operator/signup-directory';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function DirectoryUnavailable() {
  return <main><div className="shell" style={{ padding: '48px 0' }}>
    <section style={{ maxWidth: 760, margin: '12vh auto' }}>
      <p className="eyebrow">Operator</p>
      <h1 className="serif" style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 400 }}>Account directory unavailable</h1>
      <p role="alert" style={{ fontSize: '1.1rem', lineHeight: 1.7 }}>The complete Entry account directory could not be loaded. No partial account list is shown.</p>
    </section>
  </div></main>;
}

export default async function OperatorSignupsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) notFound();

  let signups;
  try {
    signups = await loadAuthorizedEntrySignups(user);
  } catch {
    return <DirectoryUnavailable />;
  }
  if (signups === null) notFound();

  return <main><div className="shell" style={{ padding: '48px 0 72px' }}>
    <section style={{ maxWidth: 960, margin: '8vh auto' }}>
      <p className="eyebrow">Operator</p>
      <h1 className="serif" style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 400 }}>Entry signups</h1>
      <p style={{ fontSize: '1.1rem', lineHeight: 1.7 }}>Every account created through Lead Emergence Entry, including internal and test accounts.</p>
      <div style={{ overflowX: 'auto', marginTop: 32 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #d9d1c3' }}>Email</th>
              <th scope="col" style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #d9d1c3' }}>Account created</th>
            </tr>
          </thead>
          <tbody>
            {signups.map((signup) => <tr key={`${signup.email}:${signup.created_at}`}>
              <td style={{ padding: '12px 8px', borderBottom: '1px solid #ebe5db' }}>{signup.email}</td>
              <td style={{ padding: '12px 8px', borderBottom: '1px solid #ebe5db' }}><time dateTime={signup.created_at}>{signup.created_at}</time></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div></main>;
}
