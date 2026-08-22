# Entry → Consulting one-login SSO

Status on 2026-08-21: **READY FOR PRODUCTION CUTOVER; cutover is not authorized or executed**. Development implementation, security review, hosted acceptance, rollback preparation, and both repository quality gates are complete. This document is the Entry-side architecture, operating contract, deployment order, rollback plan, and cutover checklist. Production changes, real users, DNS, and traffic remain outside this change.

## Authority boundary

Entry owns:

- authentication and password recovery for the Lead Emergence account;
- the canonical user UUID;
- minimal profile claims shared through OIDC;
- global `CONSULTING` eligibility (`ACTIVE`, `SUSPENDED`, or `REVOKED`);
- the OAuth client allow-list and approval decision.

Consulting alone owns its people, roles, organizations, memberships, assignments, engagements, tenant selection, record visibility, and RLS. `CONSULTING = ACTIVE` permits an OAuth entry attempt; it grants none of those Consulting permissions. A verified OIDC identity link is also not a membership.

```text
Entry authentication + ACTIVE Consulting entitlement
                         │ exact OAuth client, PKCE, consent
                         ▼
Consulting Auth custom OIDC identity
                         │ durable canonical identity link
                         ▼
Consulting person → role/membership/assignment → tenant/context → RLS
```

No product may administer Entry eligibility, and Entry must not create or infer Consulting authorization. Email is profile data, never the linking key.

## Current OAuth contract

1. A normal visit to Consulting `/login` redirects to Consulting `/auth/entry`; there is no second normal login page.
2. Consulting starts Supabase Auth OAuth with its exact custom provider identifier and a fixed callback mode.
3. Entry authenticates the user once. If authentication is already present, no password is requested.
4. Entry `/oauth/consent` asks Supabase Auth for the authorization details, accepts only `ENTRY_CONSULTING_OAUTH_CLIENT_ID`, and reads only the current user's active products through `public.get_my_active_entry_products()`.
5. Entry approves only when the exact client is allowed and `CONSULTING` is still `ACTIVE`. It performs the entitlement check for first consent and again for a remembered/automatic grant.
6. Entry accepts only the configured Consulting Supabase Auth origin, the exact `/auth/v1/callback` path, no credentials or fragment, and HTTPS except for loopback development.
7. Consulting exchanges the authorization code, requires exactly one identity from the configured provider, and requires the provider `sub` to be a UUID equal to Entry's canonical user UUID.
8. Consulting persists that proof atomically and then resolves all local access independently.

The consent POST is same-origin checked. Callback destinations and login continuations are allow-listed, not arbitrary URLs. OAuth errors fail closed without creating a Consulting session.

### Session and revocation semantics

- Signing out of Consulting clears the Consulting session but intentionally leaves the Entry session available for another one-login authorization.
- Signing out of Entry ends the Entry session. Product logout and global Entry logout are separate user actions during coexistence.
- Suspending, revoking, or removing the Entry entitlement blocks the next authorization, including a remembered grant. It does not manufacture or remove Consulting memberships.
- Entry eligibility is an entry-time check, not a per-request Consulting authorization check. For urgent removal of an already-issued Consulting session, the incident operator must also revoke that Consulting Auth session and, where appropriate, revoke the Consulting identity link or local membership under Consulting's own procedure.
- OAuth grant revocation forces fresh consent but does not replace entitlement, session, or Consulting authorization revocation.

## Entry data and API surface

The `entry_identity` schema stays outside the Data API schema allow-list. Browser clients cannot query its tables directly.

- `public.get_my_active_entry_products()` is an authenticated, self-only read returning product names only.
- `public.set_entry_product_entitlement(...)` is a service-role-only command that validates input, changes global eligibility, and writes `ENTRY_PRODUCT_ENTITLEMENT_SET` to the Entry audit log.
- Private profile, entitlement, audit, product-link, and transitional nonce tables retain RLS and least-privilege grants.
- `public.rls_auto_enable()` has no browser-role execute grant, and supporting foreign-key indexes cover revocation/audit cleanup paths.

Applied Entry migration order is additive and immutable:

1. `20260819000000_identity_foundation.sql`
2. `20260821180830_entry_entitlement_admin_command.sql`
3. `20260821181848_entry_identity_read_api.sql`
4. `20260821204921_entry_identity_advisor_hardening.sql`
5. `20260821210403_entry_handoff_service_role_grants.sql`

The fifth migration corrects transitional handoff grants without editing the already-applied foundation migration.

## Password recovery

Entry owns `/forgot-password`, `/auth/callback?next=/update-password`, and `/update-password`.

- Recovery returns the same success response for submitted accounts and exposes no account-existence signal from the UI.
- The callback exchanges a one-time PKCE code and accepts only a safe internal continuation.
- The new password must be 12–128 characters.
- A successful change signs out the recovery session before returning to login.
- Production Auth redirect allow-lists must contain the exact Entry callback URL. Wildcard recovery redirects are prohibited.

## Configuration and credential separation

Entry application variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only)
- `APP_ORIGIN`
- `CONSULTING_PRODUCT_URL`
- `ENTRY_CONSULTING_OAUTH_CLIENT_ID`
- `ENTRY_CONSULTING_OAUTH_REDIRECT_ORIGIN`

Consulting must use a separately registered OAuth client per environment. Development, preview, and production client IDs and provider configuration must never be reused across trust boundaries. Secrets and private keys stay in the deployment secret store; they are not browser variables, repository files, PR text, screenshots, or test logs. Rotate any credential that is copied outside its intended environment and record the rotation without recording the value.

For local acceptance, scripts consume environment variables in memory and restrict mutable fixtures to reserved `.test` identities. The Entry development project `vnjdubrnmxvmsccxmhst` is the only writable remote used by this work. The shared Consulting/Ministry project remains read-only until a separately approved change window.

## Coexistence and legacy handoff classification

The OAuth/OIDC flow above is the canonical path. The older 90-second RS256/JWKS/JTI POST handoff (`/.well-known/jwks.json`, `/api/handoff/redeem`, and Consulting `/auth/handoff`) is classified **rollback-only during coexistence**:

- keep it unchanged while the OAuth release is being proven;
- do not add users, claims, capabilities, or new consumers;
- monitor for use and document the last-use time;
- retire it only after production OAuth burn-in, successful rollback rehearsal, and explicit approval;
- remove its signing/redemption credentials after retirement.

Legacy Consulting password login remains available only at the explicit `/login?legacy=1` rollback URL. Normal Consulting `/login` auto-starts Entry SSO. Do not remove legacy availability in this cutover.

## Deployment and migration order

Use a reviewed change window and stop on any failed gate.

1. Back up both target databases and record restore ownership and recovery point.
2. Verify the Entry target migration history exactly; do not rewrite an applied migration.
3. Apply the four additive Entry migrations after the foundation migration.
4. Configure the Entry production `site_url`, exact recovery redirects, OAuth server, exact Consulting client, and exact callback origin.
5. Deploy Entry and prove login, recovery, consent deny/allow, remembered-grant entitlement recheck, security headers, audit events, and fail-closed behavior.
6. In the Consulting target, first apply its prerequisite `20260819110000_consulting_prospect_321.sql` if absent, then `20260821171434_entry_oidc_identity_linking.sql`.
7. Register/configure the environment-specific Consulting custom provider and fixed callback URLs.
8. Deploy Consulting while preserving `/login?legacy=1` and the transitional handoff.
9. Run the full hosted acceptance matrix with synthetic identities before any real user is invited.
10. Enable traffic only after the named release owner records approval. DNS or production cutover is a separate action.

Never compensate for a failed migration with destructive production rollback. Prefer forward repair, restore only under the approved database recovery plan, and keep the legacy login route available.

## Hosted acceptance matrix

The release evidence must include all of the following against production-shaped, isolated hosted backends:

| Case | Required result |
| --- | --- |
| First Entry sign-in with `ACTIVE` | One password entry; explicit consent; one Consulting session; one durable link. |
| Repeat sign-in | No second password; remembered grant still rechecks `ACTIVE`; no duplicate link/person. |
| `SUSPENDED`, `REVOKED`, absent | No Consulting session or identity-link mutation. |
| Revoked with remembered grant | Automatic branch is stopped before callback/session creation. |
| Linked person with active local membership | Consulting authorizes only the matching local role and tenant. |
| Linked person with no membership | Safe no-workspace state; no product data. |
| Removed membership | Access disappears under Consulting policy without changing Entry identity. |
| Wrong tenant | 404/empty result according to Consulting's endpoint contract. |
| Consultant-private material | Empty/denied for client session while a server-side control proves the fixture exists. |
| Existing Consulting account | Link only after explicit authenticated confirmation; no email-only merge. |
| Consulting logout | Consulting session clears; Entry session can authorize again without password. |
| Entry recovery | Mail delivered, callback exchanged, password changed, recovery session signed out, old password rejected. |
| Error/tamper | Unknown client, callback, mode cookie, provider subject, open redirect, and replay all fail closed. |

## Observability and incident operation

Monitor counts and failure rates for OAuth starts, approvals/denials, callback exchanges, entitlement failures, `ENTRY_PRODUCT_ENTITLEMENT_SET`, Consulting `ENTRY_IDENTITY_LINK_CREATED`, and `ENTRY_SSO_IDENTITY_VERIFIED`. Alert on repeated callback validation failures, client mismatch, provider-subject mismatch, unexpected duplicate-link conflicts, elevated recovery errors, or legacy-login use after the burn-in window.

Logs must use correlation IDs and stable error categories, not access tokens, authorization codes, cookies, passwords, client secrets, recovery links, or full profile payloads. Audit events must support reconstruction of who changed eligibility and when Consulting linked or reverified an Entry identity.

Incident order:

1. stop new OAuth authorizations by disabling the environment-specific client or Entry eligibility command path;
2. preserve Entry authentication and the explicit Consulting legacy route if they are safe;
3. revoke affected Consulting sessions and local authorization when immediate containment is required;
4. rotate exposed credentials and invalidate grants;
5. inspect audit/correlation evidence;
6. use forward repair or the approved restore plan;
7. re-enable only after the full matrix passes again.

## Current verification evidence

On 2026-08-21, isolated development and hosted-preview testing passed:

- clean Entry database rebuild and 44 pgTAP assertions;
- 13 unit tests, lint, typecheck, production build, schema lint, and dependency audit with zero vulnerabilities;
- real OAuth first/repeat arrival with one Entry password, one durable Consulting link, no automatic membership or assignment, and expected audit events;
- `ACTIVE`, `SUSPENDED`, `REVOKED`, absent, and revoked-with-remembered-grant cases;
- explicit existing-account linking and active/no-membership/removed-membership/wrong-tenant/private-record authorization cases;
- Consulting-only logout followed by passwordless reauthorization from the surviving Entry session;
- Entry dev hosted `site_url`, exact callback, OAuth server, confidential Consulting client, consent route, and one-key JWKS configuration;
- dedicated hosted Consulting dev project with the exact 21-migration chain and 361 local/CI pgTAP assertions, plus hosted catalog verification of the approved service-only prospect-note RLS hardening;
- protected Vercel previews completing the full Entry entitlement and Consulting local-authorization matrices without a second Consulting password page or browser console errors;
- real local mailbox password recovery with old-password rejection and zero browser errors.

Hosted acceptance used only reserved `.test` identities and synthetic Consulting fixtures in the dedicated development backend. It did not read or write the shared Consulting/Ministry project, production users, or production traffic.

## Production cutover gate — development proof complete

Do not cut over until every item below is complete:

- both separate code PRs are green, reviewed, and merged in the approved order;
- production Entry Auth has the approved public `site_url`, exact callback/recovery allow-list, OAuth server, and separately rotated Consulting client registration;
- leaked-password protection is enabled or an explicitly approved compensating control/risk acceptance exists;
- the production Consulting target has the prerequisite canonical-link migration and new OIDC-link migration, plus the approved environment-specific provider, origins, exact callbacks, and rotated credentials;
- the production Consulting migration plan includes the approved `20260822025341_harden_prospect_notes_rls.sql` service-only defense-in-depth migration;
- Backup/restore evidence, credential rotation, monitoring dashboards/alerts, operator ownership, rollback rehearsal, real-user duplicate/conflict review, support messaging, and explicit cutover approval are recorded.
- a production-window synthetic canary repeats first-time, returning, denial, logout, and local-revocation paths before real-user linking.

Development acceptance is complete and the system is **READY FOR PRODUCTION CUTOVER**. Production configuration, migration, merging, canary execution, and real-user linking remain separately approved actions; merge alone does not authorize infrastructure or traffic changes.
