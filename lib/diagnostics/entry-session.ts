import { createHash } from 'node:crypto';

const ENTRY_SESSION_FINGERPRINT_SALT = 'lead-emergence:entry-session-diagnostic:v1:';

/**
 * Produces a short comparison value for an operator-only session diagnostic.
 * It is deliberately not an authentication or authorization value.
 */
export function entrySessionSubjectFingerprint(canonicalUserId: string): string {
  return createHash('sha256')
    .update(`${ENTRY_SESSION_FINGERPRINT_SALT}${canonicalUserId}`)
    .digest('hex')
    .slice(0, 12);
}

export const entrySessionFingerprintSql = "left(encode(digest('lead-emergence:entry-session-diagnostic:v1:' || id::text, 'sha256'), 'hex'), 12)";
