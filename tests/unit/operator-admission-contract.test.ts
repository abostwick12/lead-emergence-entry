import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260901153604_entry_operator_client_admission.sql', 'utf8');
const edgeFunction = readFileSync('supabase/functions/operator-clients/index.ts', 'utf8');

describe('Entry owner-approved Personal admission contract', () => {
  it('keeps operator authority and lifecycle records private and service-mediated', () => {
    expect(migration).toMatch(/create table if not exists entry_identity\.entry_operators/i);
    expect(migration).toMatch(/create table if not exists entry_identity\.personal_admission_requests/i);
    expect(migration).toMatch(/alter table entry_identity\.entry_operators enable row level security/i);
    expect(migration).toMatch(/create or replace function public\.bootstrap_entry_operator/i);
    expect(migration).toMatch(/if exists \(select 1 from entry_identity\.entry_operators\)/i);
    expect(migration).toMatch(/interval '1 hour'\) >= 20/i);
  });

  it('uses the existing entitlement command, not entitlement-table writes', () => {
    expect(edgeFunction).toMatch(/rpc\("set_entry_product_entitlement"/);
    expect(edgeFunction).toMatch(/p_product: "PERSONAL"/);
    expect(edgeFunction).toMatch(/p_status: "ACTIVE"/);
    expect(edgeFunction).toMatch(/p_source: "owner_personal_invite_v1"/);
    expect(edgeFunction).toMatch(/"owner_personal_suspension_v1"/);
    expect(edgeFunction).toMatch(/"owner_personal_reactivation_v1"/);
    expect(edgeFunction).not.toMatch(/\.from\("product_entitlements"\)\.(insert|update|upsert)/);
  });

  it('requires an active AAL2 operator and keeps contact data out of responses and logs', () => {
    expect(edgeFunction).toMatch(/getAuthenticatorAssuranceLevel\(token\)/);
    expect(edgeFunction).toMatch(/currentLevel !== "aal2"/);
    expect(edgeFunction).toMatch(/rpc\("is_entry_operator_service"/);
    expect(edgeFunction).toMatch(/new URL\("\/auth\/callback\?next=%2Fworkspaces", entryOrigin\)/);
    expect(edgeFunction).not.toMatch(/console\./);
    expect(edgeFunction).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('uses opaque admission references and revokes Workspace MCP grants through the service boundary', () => {
    expect(edgeFunction).toMatch(/list_personal_clients/);
    expect(edgeFunction).toMatch(/set_workspace_personal_admission_status/);
    expect(edgeFunction).toMatch(/ENTRY_OPERATOR_SUSPENSION/);
    expect(edgeFunction).toMatch(/admission_ref/);
    expect(edgeFunction).not.toMatch(/admission_id/);
    expect(migration).toMatch(/get_entry_personal_admission_subject\(p_request_fingerprint text\)/);
    expect(migration).toMatch(/set_entry_personal_admission_state\(p_request_fingerprint text/);
  });
});
