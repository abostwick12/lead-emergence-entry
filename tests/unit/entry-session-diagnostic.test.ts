import { describe, expect, it } from 'vitest';
import { entrySessionSubjectFingerprint, entrySessionFingerprintSql } from '@/lib/diagnostics/entry-session';

describe('entry session diagnostic', () => {
  it('produces a stable, short fingerprint without returning the subject', () => {
    const subject = '00000000-0000-4000-8000-000000000001';
    const fingerprint = entrySessionSubjectFingerprint(subject);

    expect(fingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(fingerprint).toBe(entrySessionSubjectFingerprint(subject));
    expect(fingerprint).not.toContain(subject);
  });

  it('documents the matching PostgreSQL SHA-256 expression', () => {
    expect(entrySessionFingerprintSql).toBe("left(encode(digest('lead-emergence:entry-session-diagnostic:v1:' || id::text, 'sha256'), 'hex'), 12)");
  });
});
