# Entry -> Workspace one-login SSO

Status: implementation is locally validated; the dedicated Entry Vercel authority and custom domain are provisioned, while the production identity backend, OAuth clients/providers, deployment, interactive acceptance, and production cutover remain incomplete.

## Boundary

Entry owns canonical authentication and the global `PERSONAL` entitlement. Workspace owns Personal provisioning, plan/capabilities, membership, record authorization, RLS, onboarding, MCP authorization, and connector authorization.

```text
Entry identity + active PERSONAL entitlement
  -> exact Workspace OAuth client and consent
  -> Workspace Supabase custom OIDC identity
  -> Personal owner membership and RLS
```

An active Entry entitlement permits an authorization attempt; it does not grant a Workspace record. Workspace must verify the provider identity and independently resolve or provision only the matching user's Personal Workspace. Email is never the identity-link key.

## Flow

1. Workspace `/auth/entry` starts Supabase custom-provider sign-in and fixes the app callback to `/auth/callback/sign-in`.
2. Entry authenticates the Lead Emergence account. An existing Entry session does not request another password.
3. Entry receives the Supabase OAuth authorization request, accepts only the configured Personal client, and rechecks the current user's active `PERSONAL` entitlement.
4. Entry validates the redirect against the exact Workspace Supabase Auth origin and `/auth/v1/callback` path. Personal and Consulting client IDs and callback origins must be distinct. If zero or multiple product configurations match, the request fails closed.
5. Entry approves or denies through its same-origin consent action.
6. Workspace requires exactly one identity from its environment-specific Entry provider and a UUID provider subject equal to the authenticated Workspace user UUID.
7. Workspace applies its own Personal provisioning, membership, plan, capability, and RLS rules before showing setup or Home.

Unknown client IDs, missing entitlements, callback ambiguity, unsafe continuations, provider mismatch, and OAuth errors fail closed. Consulting retains its existing independent OAuth client, destination, callback origin, entitlement check, and architecture.

## Environment configuration

Entry adds:

- `ENTRY_PERSONAL_OAUTH_CLIENT_ID`
- `ENTRY_PERSONAL_OAUTH_REDIRECT_ORIGIN`

`PERSONAL_PRODUCT_URL` remains environment-specific and is `https://workspace.leademergence.com` only in Production. Workspace's Supabase Auth callback origin is not the Workspace application origin; it is the exact hosted Auth origin that receives `/auth/v1/callback`.

Each Development, Preview, and Production environment needs a separate Workspace OAuth client and custom provider. Do not reuse client secrets, client IDs, callback origins, or provider identifiers across environments. Secrets remain in provider/deployment secret stores and never in public variables, repository files, logs, screenshots, or PR descriptions.

## Coexistence and rollback

Ministry retains the existing legacy handoff. Consulting retains its existing one-login implementation. Personal changes do not alter either product's authorization.

Workspace's explicit password login remains rollback-only during the SSO proving period. If the Personal client/provider fails, disable only that environment-specific client/provider or restore the prior Entry deployment. Preserve Entry authentication, Consulting routing, the Workspace Vercel rollback URL, and all Personal data. Do not retire rollback authentication until a separately approved stabilization decision.

## Acceptance required before cutover

- active Personal entitlement reaches Workspace setup with no second password;
- absent/suspended/revoked entitlement cannot create a Workspace session or Personal data;
- first authorization and remembered grant both recheck the Personal entitlement;
- exact client, redirect, provider identifier, subject, mode cookie, and continuation validation fail closed;
- first user reaches setup-method choice, incomplete user resumes, ready user reaches Home;
- Personal membership/RLS remains the only record authorization;
- logout, account recovery through Entry, provider denial, callback error, and rollback login are safe;
- Personal and Consulting clients continue to route only to their own callbacks;
- browser console, network, deployment logs, security headers, and secret scan are clean.

A production merge, hosted provider change, secret entry, synthetic Production canary, and real-user activation each remain separately approval-gated.

## Candidate evidence — 2026-08-22

- typecheck, lint, and Next.js `16.3.1` production build: pass;
- unit tests: 15/15 pass, including ambiguous client/callback fail-closed mapping;
- unchanged Entry schema: local database lint passes with no errors and all 44 entitlement/identity pgTAP assertions pass;
- full dependency audit: 0 findings;
- sensitive-data scan: pass across preserved repository history and the authored working tree; no secret was found;
- Preview destination and application origin are aligned to the dedicated Workspace and Entry branch aliases;
- `ENTRY_PERSONAL_OAUTH_REDIRECT_ORIGIN` targets the dedicated Personal Supabase Auth origin, not the Workspace application origin;
- Preview deployment `dpl_9ngWJuLsURVYaw9LNzFV5jD6ueXd` is READY, its public login and JWKS contracts pass, and its bounded runtime-log query contains no error-level or 5xx event;
- no OAuth client, provider secret, Production Entry project/alias, real user, billing, or cutover was created or changed.

The dedicated Vercel project `lead-emergence-entry` (`prj_Sjv0ZfqFzf7dOOime4bEWZukmaCD`) now owns the verified DNS-only custom domain `https://entry.leademergence.com`. It is connected to `abostwick12/lead-emergence-entry`, uses `main` as its eventual production branch, and is pinned to Next.js on Node `24.x`. Its Production configuration contains the exact Entry, Workspace, Consulting, Ministry, and Supabase Auth origins plus a newly generated, environment-specific RSA handoff keypair and redemption secret. Credential values exist only in Vercel's secret/config store.

No deployment or traffic is assigned to the new project. Its Supabase URL/keys and Personal/Consulting OAuth client IDs remain absent by design. The only current Entry backend is the isolated development project `vnjdubrnmxvmsccxmhst`; before deployment, create and secure a distinct production Entry identity project, apply the reviewed Entry migrations, configure exact Auth redirects/OAuth clients, and complete synthetic acceptance. `www.leademergence.com` remains the Ministry application and was not repurposed.
