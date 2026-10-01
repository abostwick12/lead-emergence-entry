'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export default function ConfirmRecoveryPage() {
  const router = useRouter();
  const [state, setState] = useState<'ready' | 'checking' | 'invalid'>('ready');

  async function confirmRecovery() {
    if (state !== 'ready') return;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token_hash');
    // Fragments are not sent in HTTP requests; remove this one from the address bar
    // before any further navigation. Only the customer browser retains the hash.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!token || token.length > 1024) {
      setState('invalid');
      return;
    }
    setState('checking');
    try {
      const { error } = await createSupabaseBrowserClient().auth.verifyOtp({
        token_hash: token,
        type: 'recovery',
      });
      if (error) {
        setState('invalid');
        return;
      }
      router.replace('/update-password');
    } catch {
      setState('invalid');
    }
  }

  return <main><div className="shell" style={{ padding: '48px 0' }}><section style={{ maxWidth: 460, margin: '12vh auto' }}>
    <p className="eyebrow" style={{ color: 'var(--teal)' }}>Account recovery</p>
    <h1 className="serif" style={{ fontSize: '3rem', fontWeight: 400 }}>Confirm account recovery</h1>
    <p>Continue only if you requested to reset your Lead Emergence password.</p>
    {state === 'invalid' && <p role="alert">This recovery link is invalid or expired. Request a new one.</p>}
    <button className="button" type="button" disabled={state !== 'ready'} onClick={confirmRecovery}>
      {state === 'checking' ? 'Confirming…' : 'Continue to choose a password'}
    </button>
    <p><Link href="/forgot-password">Request a new recovery link</Link></p>
  </section></div></main>;
}
