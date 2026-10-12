# Entry-dev Auth boundary draft

Status: **DRAFT. No deployment or Auth change authorized or performed.**

## Scope and owner clearance

IN SCOPE: Andrew's October 12 `yes` clears isolated Entry-dev deployment/environment draft preparation alongside PR19. The subsequent instructions authorize the nine-file review packet, draft PR, the tenth file `vercel.json` to disable deployment for this branch, and this bounded README/configuration reconciliation plus prerequisite and exact-head Auth review. Deployment, Auth mutation, merge, real sign-in and OAuth consent remain unapproved. Branch `codex/entry-dev-auth-boundary-draft` starts at Entry main `0b278fe7254c86e18adcd1215af86d54e36f3411`. Existing signup, recovery, front-door and PR19 worktrees are preserved. Changes are limited to this review directory and the approved branch-specific root configuration; application source is unchanged.

Canonical governance was read through signed-in GitHub, starting with AGENTS.md, followed by ROADMAP.md, PRODUCTION_STATE.md, DECISIONS.md, BACKLOG.md and state-refresh, assumption-challenge and scope-lock protocols. Current engineering authorization is Phase 2/3. This task supports the Entry sign-in boundary; it closes no customer release gate.

## Claim and falsifier

CLAIM: Entry-dev OAuth's configured consent UI crosses into the production Entry application.

FALSIFIER: The vnj OAuth Server dashboard derives a dedicated nonproduction consent URL, or the current Entry production configuration uses vnj.

FALSIFIER RESULT — VERIFIED on October 12, 2026, approximately 16:10–16:18 UTC: vnj's signed-in dashboard has Site URL `https://entry.leademergence.com`, OAuth enabled, Authorization Path `/oauth/consent`, and Preview Authorization URL `https://entry.leademergence.com/oauth/consent`. Current Vercel Production configuration for Entry instead has `NEXT_PUBLIC_SUPABASE_URL=https://neabiaimygdviwobpicj.supabase.co`. This proves the configured environment mismatch, not the outcome of a newly executed OAuth transaction.

Supabase documents this Site URL + Authorization Path behavior: https://supabase.com/docs/guides/auth/oauth-server/getting-started#configure-your-authorization-path . Exact allowed URLs and their fallback behavior are described at https://supabase.com/docs/guides/auth/redirect-urls . The observed dashboard is the source for this project's actual settings.

Alternative explanation retained: a particular explicit Auth redirect could choose another allowlisted destination, or an actual flow could stop earlier. No real authorization request, credential submission, code exchange or consent was performed. Do not label the configured mismatch as a reproduced successful end-to-end flow.

## Live evidence

VERIFIED: [URL Configuration](https://supabase.com/dashboard/project/vnjdubrnmxvmsccxmhst/auth/url-configuration), project `lead-emergence-entry-dev`, organization `Lead emergence sandbox`, contains exactly the seven URLs in `auth-url-change.draft.json` -> `before`. The current authorization endpoints use `vnjdubrnmxvmsccxmhst.supabase.co`. See `auth-url-configuration.jpg`, `auth-redirect-allowlist.jpg`, and `auth-oauth-server.jpg`. The narrow browser screenshot clips some long URL lines; the exact complete strings were read from the signed-in accessibility tree and transcribed in the JSON. No credentials or session material are included.

VERIFIED: Production Entry domain resolves in Vercel metadata to READY `dpl_2NGPuAYkZrpo4h5gpRyUNXBovA6k`, URL `lead-emergence-entry-h0napmdcq-emergence-projects.vercel.app`, project `prj_Sjv0ZfqFzf7dOOime4bEWZukmaCD`. Only the nonsecret Supabase URL configuration was read, env ID `pCO4PMxqfsa2Gf93`; its value is `https://neabiaimygdviwobpicj.supabase.co`. Configuration at inspection time is not an attestation of all historic build inputs.

VERIFIED: Existing Entry SSO-preview is READY `dpl_JBEtPrWN2yN2mXKXgz2bkRXxUiSk`, URL [Entry candidate login](https://lead-emergence-entry-sso-preview-acqwy1ot5-emergence-projects.vercel.app/login), source Entry main `0b278fe7254c86e18adcd1215af86d54e36f3411`, project `prj_kqi3BE9KJkJOJBWIDzd4JqZxMVnG`. Its Vercel target is `production` within the separate SSO-preview project; it is not a Preview-target candidate for this draft. Project environment inventory returned `envs: []`. Login renders. GET `/auth/callback` without a code redirects to same-host `/login?error=invalid_callback`. GET `/oauth/consent` without an ID displays an incomplete-request message. These guards do not establish successful sign-in, vnj binding or functional consent. This deployment is not approved as the new Auth destination.

VERIFIED: An existing **Workspace** deployment is demonstrably bound to vnj: READY Preview `dpl_5BSJbW4Rbk37abZdMqPbmzChbPDG`, [immutable login URL](https://lead-emergence-workspace-nifyyjvm5-emergence-projects.vercel.app/login), source `3fca013398851671446d713aebb684b48b79eb29`, branch `codex/entry-dev-preview-mcp-resource-review`, project `prj_ANnBP1Pxceok4uezHzHPjOTs2cCb`. Its branch-scoped `NEXT_PUBLIC_SUPABASE_URL` env ID `HrSxYmP7vUf8OzYv` reads `https://vnjdubrnmxvmsccxmhst.supabase.co`. More directly, its actually loaded HTTP-200 script `/_next/static/immutable/chunks/1qmlo1yj0ti82.js` contains that exact Supabase origin. Only origin matches were extracted from the public response body; no keys, tokens or full bundle are retained. See `workspace-public-binding.json`. Its login presents Workspace and links to `/auth/entry?next=%2Fworkspace`; it is not a dedicated Entry deployment. Vercel deployment-file listing failed with 404, so no uploaded-file attestation is claimed.

## Smallest supported correction

Existing Entry routes already provide the required UI. Source at the pinned SHA uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `lib/supabase/server.ts:7`; login uses that client in `app/login/actions.ts`. `app/auth/callback/route.ts:8` fixes callback continuation to `APP_ORIGIN`; `app/forgot-password/actions.ts:17` requests the exact recovery callback query. `lib/oauth/server.ts:54` preserves `/oauth/consent?authorization_id=...`. No route rewrite is necessary for this draft.

1. Separately approve one Preview-target deployment in the existing Entry SSO-preview project, with explicit vnj binding and proposed dedicated origin `https://lead-emergence-entry-dev.vercel.app`. This hostname is proposed, unprovisioned and not ownership-verified. See `deployment-plan.draft.json`; it cannot be executed as approved configuration yet.
2. After READY, fill in the actual immutable deployment ID/URL and collect public build/header plus server configuration evidence for vnj, hostname assignment, login and exact callback. The current Workspace preview and any old allowlisted hostname cannot substitute for this evidence.
3. Only then review and separately approve the Entry-dev Auth Site URL and exact two callback additions in `auth-url-change.draft.json`. Authorization Path remains `/oauth/consent`. No existing URL is removed without a consumer inventory and separate exact review.

This corrects the demonstrated default destination so development authorization does not open the production Entry app, whose configured Auth project differs. Leaving it unchanged continues that mismatch. The add-only allowlist draft deliberately exposes a remaining limit: explicit legacy Production redirects remain permitted. **Full environment isolation is not achieved by this minimal diff.** An Auth-owner consumer inventory and exact dev-only replacement allowlist are required before claiming that broader result.

## Callback distinctions and validation stop

Entry `/auth/callback` is Entry's login/session callback. `/auth/callback?next=%2Fupdate-password` is its exact recovery variant. A product provider's Supabase `/auth/v1/callback`, Workspace `/auth/callback/sign-in`, and an OAuth client's registered redirect URI serve different contracts. An eventual ChatGPT callback must be read from the actual approved client; it cannot be invented or replaced with Entry's session callback.

BLOCKER: project-matched publishable-key provisioning and dedicated hostname assignment remain unverified. Required Entry-dev entitlement/MCP RPC catalog availability was subsequently checked below; successful login, real consent and exact client callback completion remain untested. A normal consent read can call `record_mcp_oauth_authorization_event` (`lib/oauth/request-classification.ts:25`), and approval can activate a grant (`app/api/oauth/decision/route.ts:34`); those are not read-only probes. They require a separately bounded execution approval. No client/authorization ID or user account is assumed suitable.

No tests or builds were run and no dependencies installed. Read-only browser guards are supporting route evidence only. No customer, ChatGPT or release acceptance is claimed.

Artifact validation: the three packet JSON files and root `vercel.json` parse with PowerShell `ConvertFrom-Json`. The current correction changes only this README, `deployment-plan.draft.json` and `vercel.json`; the application, library, Supabase and workflow source diff against the pinned main baseline is empty. The exact branch-only deployment-disable rule and shared schema declaration were checked. Scoped elevated `git diff --check` passes. The earlier unprivileged `git diff --check` failed with the environment error `fatal: this operation must be run in a work tree`; that is retained as an access-context failure, not a source validation failure. The initial unprivileged fetch could not write the shared external `FETCH_HEAD`; scoped elevated fetch succeeds. The signup branch remains at its original HEAD with no source edits.

## Review status and next boundary

IN SCOPE — Published draft [PR20](https://github.com/abostwick12/lead-emergence-entry/pull/20) contains review commit `25a267440949ef9c17fecb557553f8a40ce16869` and the separately approved branch-deployment disable `f3f9847475ff562b52889a4a28f99d8373159941`. Publishing is complete. The post-publication branch inventory returned zero deployments. CodeRabbit explicitly skipped automatic review because the PR was a draft; its SUCCESS status was not an Auth review. The current correction requires a new exact-head review receipt, recorded on the PR after the final commit; no earlier review is reused.

IN SCOPE — PR19 at `8673bcbec3d212ad66ba4e7bc2f46ab49ed8053b` adds only a `$schema` declaration in `vercel.json`. This branch preserves that exact declaration and adds only the previously approved branch-specific `git.deploymentEnabled` rule. The resulting configuration is the intended content resolution. A non-mutating `git merge-file --stdout` simulation against the empty common-base file returned exit 1: Git still sees an add/add conflict. It is not reported as a clean cross-PR merge. Both branches remain unchanged apart from this task's isolated branch. Before any future merge, the owner must reconcile the two additions by retaining this combined file; no PR19 code, migration, rebase or merge is adopted here.

## Read-only prerequisite refresh — October 12, 2026

CLAIM: the proposed Preview has enough pinned configuration and dependencies to request deployment approval. FALSIFIER: missing project-matched configuration or an unassigned dedicated hostname. FALSIFIER RESULT: the signed-in Vercel inventory has no project variables and no linked shared variables; its domain list contains only `lead-emergence-entry-sso-preview.vercel.app`, assigned to Production in the separate SSO-preview project. The proposed Entry-dev hostname is not assigned there. Therefore deployment approval is **BLOCKED**, not ready to present. An Add Domains form accepting the hostname text proves syntax only; it was canceled without submission and does not prove availability or ownership.

VERIFIED — Signed-in [project General settings](https://vercel.com/emergence-projects/lead-emergence-entry-sso-preview/settings/general) display project ID `prj_kqi3BE9KJkJOJBWIDzd4JqZxMVnG`. [Project variables](https://vercel.com/emergence-projects/lead-emergence-entry-sso-preview/settings/environment-variables) display `No Environment Variables Added`; the Shared tab displays `No shared variables linked`. [Domains](https://vercel.com/emergence-projects/lead-emergence-entry-sso-preview/settings/domains) display the single existing default domain above. No values, credentials, variable associations or hostname assignments were changed. The authenticated connector's project/env/domain reads returned 404 with both slug and explicit team scope; the signed-in dashboard is the successful source, not an inference that the project was deleted.

VERIFIED — Catalog-only SQL in `BEGIN READ ONLY` on [the pinned Entry-dev SQL editor](https://supabase.com/dashboard/project/vnjdubrnmxvmsccxmhst/sql/5e5fa029-763f-4b76-a363-f30f7b54f5bb) returned `transaction_read_only=on` at `2026-10-12T16:47:40.454193+00:00`. All four Entry source-call contracts are present, allow authenticated EXECUTE and deny anon EXECUTE; the respective authenticated schema USAGE checks are true:

| RPC identity | Result | Definition MD5 |
| --- | --- | --- |
| `public.get_my_active_entry_products()` | `TABLE(product entry_identity.entry_product)` | `030ba58bfdcc0a5b4581dadd89bac7c6` |
| `workspace.resolve_mcp_oauth_authorization(p_authorization_id text)` | `TABLE(request_class text, denial_code text, expected_redirect_uri text, requested_scopes text[], grant_active boolean)` | `82d9c15e723ac508a38ef2c310852dfa` |
| `workspace.activate_mcp_oauth_grant(p_authorization_id text)` | `jsonb` | `cfae682352b446242a5e20a7c095be5a` |
| `workspace.record_mcp_oauth_authorization_event(p_authorization_id text, p_event_type text, p_reason_code text)` | `void` | `0dac813622c4027aac4d0fee9211e784` |

Reproducible catalog check (does not execute the RPCs):

```sql
begin read only;
with expected(schema_name, function_name) as (values
  ('public','get_my_active_entry_products'),
  ('workspace','resolve_mcp_oauth_authorization'),
  ('workspace','activate_mcp_oauth_grant'),
  ('workspace','record_mcp_oauth_authorization_event')
)
select e.*, p.oid is not null as present,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_schema_privilege('authenticated',n.oid,'usage') as authenticated_schema_usage,
       md5(pg_get_functiondef(p.oid)) as definition_md5
from expected e
left join pg_namespace n on n.nspname=e.schema_name
left join pg_proc p on p.pronamespace=n.oid and p.proname=e.function_name;
rollback;
```

VERIFIED — Subsequent read-only definition/catalog inspection at `2026-10-12T16:50:53.696674+00:00` found the private resolver, admission-event recorder, fingerprint and admission-control functions; `extensions.digest(text,text)` is present. Required relations `auth.oauth_authorizations`, `auth.oauth_clients`, `entry_identity.product_entitlements`, `workspace_private.mcp_oauth_resource_grants`, `workspace_private.mcp_oauth_admission_audit` and `workspace_private.product_settings` are present. Authenticated has SELECT and schema USAGE for the entitlement table used by the invoker RPC. The [Data API settings](https://supabase.com/dashboard/project/vnjdubrnmxvmsccxmhst/integrations/data_api/settings) show Data API enabled and checked exposed schemas `graphql_public`, `public`, `workspace`; `workspace_private` and `entry_identity` are not exposed directly.

VERIFIED — Reading only the three named nonsecret `workspace_private.product_settings` entries returned `mcp_dynamic_admission_enabled=true`, `mcp_resource_uri=https://workspace.leademergence.com/api/mcp`, and `mcp_preview_resource_uri=https://lead-emergence-workspace-entry-dev.vercel.app/api/mcp`. The private resolver definition permits either configured resource and validates the actual client's exact registered redirect plus PKCE. This is catalog/control evidence, not full environment isolation, a suitable client binding, an entitled test identity or successful authorization. No authorization/client/grant/customer rows were selected and no application RPC was called.

BLOCKER — Before presenting one Preview for deployment approval, obtain owner-confirmed hostname availability/assignment scope and secure project-matched Preview configuration for this branch (including the matching publishable key), then verify them read-only. Use one immutable commit SHA from the completed exact-head Auth review in the external approval request, not a moving branch name; the plan's `sourceSha` identifies the unchanged application baseline. Deployment acceptance, Auth approval and any real login/consent execution remain separate scoped decisions. Canonical status/decision files were read but not changed.
