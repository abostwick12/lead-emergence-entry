# Entry-dev Auth boundary draft

Status: **DRAFT. No deployment or Auth change authorized or performed.**

## Scope and owner clearance

IN SCOPE: Andrew's October 12 `yes` clears isolated Entry-dev deployment/environment draft preparation alongside PR19. The subsequent instruction authorizes committing exactly these nine review files and opening a draft PR, subject to making no deployment or Auth change. It does not approve deployment, Auth mutation, merge, a real sign-in or OAuth consent. Branch `codex/entry-dev-auth-boundary-draft` starts at fresh Entry main `0b278fe7254c86e18adcd1215af86d54e36f3411`. Existing signup, recovery, front-door and PR19 worktrees are preserved. Only this review directory is changed; application code and existing configuration are unchanged.

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

ASSUMED / BLOCKER: project-matched publishable-key provisioning, dedicated hostname availability, required Entry-dev entitlement/MCP RPC availability, actual successful login, real consent, and exact client callback completion. A normal consent read can call `record_mcp_oauth_authorization_event` (`lib/oauth/request-classification.ts:25`), and approval can activate a grant (`app/api/oauth/decision/route.ts:34`); those are not read-only probes. They require a separately bounded execution approval. No client/authorization ID or user account is assumed suitable.

No tests or builds were run and no dependencies installed. Read-only browser guards are supporting route evidence only. No customer, ChatGPT or release acceptance is claimed.

Artifact validation: all three JSON files parse with PowerShell `ConvertFrom-Json`. `git status --porcelain --untracked-files=all` lists only this review directory; `git ls-files --modified --deleted` returns no tracked source changes. `git diff --check` fails with the pre-existing environment error `fatal: this operation must be run in a work tree`; it is not reported as passing. The initial unprivileged fetch could not write the shared external `FETCH_HEAD`; the approved scoped elevated fetch succeeded before worktree creation. The signup branch remains at its original HEAD with no source edits.

## Review status and next boundary

Nine-file commit and draft PR are authorized; no CodeRabbit review is complete. Publishing remains blocked until automatic deployment is demonstrably suppressed for this branch. Read-only inspection of the SSO-preview project's signed-in Vercel Git settings shows the Entry repository connected; Build and Deployment settings show Ignored Build Step = Automatic and change-based skipping disabled. There is no repository `vercel.json` at the pinned source. A documentation-only push must not be assumed deployment-free. No Git integration or build setting was changed. Review first the proposed nonproduction project/origin/configuration and unresolved prerequisites. Deployment approval, Auth approval, and any real login/consent execution remain separate scoped decisions. Current main source divergence and PR19's release blockers remain owned by that work; this draft imports none of its code or migrations. Canonical status/decision files were read but not changed.
