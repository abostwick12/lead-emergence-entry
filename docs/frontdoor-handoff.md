# Lead Emergence public front door — source handoff

Repository: lead-emergence-entry. Dedicated worktree: C:/Users/awbostwick/Documents/ChatGPT/Lead Emergence Entry Product. Branch: astra/lead-emergence-front-door. Starting commit: ef7fd32a573f2f03c0be24f50007ceed600406f2, the published origin/main inspected before editing. The older entry-operational-readiness checkout and its seven unpublished auth commits were preserved; they were not imported or published.

## Product and visual result

One platform landing retains the individual-leader philosophy, dark photography, restrained serif typography, cyan journey thread and later gold. SOTF is the concrete invitation-based 14-day pathway within the wider platform. A fictional decision example changes MAYBE to NO when the visitor makes decision ownership non-negotiable; switching Workspace/ChatGPT retains that example's state. It demonstrates reviewed criteria and follow-through without claiming live account access.

All authentication CTAs use /login, with no product-specific next parameter. The prior direct product-login CTAs were removed. Existing login forms, callbacks, cookie/session ownership, entitlement checks, chooser, handoff endpoints, OAuth continuations, proxy and CSP remain unchanged. The global Google Fonts import was removed because the existing CSP already blocked it; CSP was not weakened. The film's canonical brief, asset briefs, render source and output evidence are separate artifacts under film/.

## Verified ownership and preserved routing

| Responsibility | Existing owner inspected |
| --- | --- |
| Public landing | Entry app/page.tsx and app/landing-experience.tsx |
| Shared credential sign-in | Entry app/login/actions.ts using existing Supabase Auth |
| Canonical identity verification | Entry lib/identity/server.ts, auth.getUser |
| Entitled destinations | Entry get_my_active_entry_products RPC and app/workspaces/page.tsx |
| Destination dispatch | Entry app/handoff/[product]/page.tsx and existing lib/oauth/server.ts / lib/handoff/server.ts |
| Auth callbacks and email confirmation | Entry app/auth/callback/route.ts and app/auth/confirm/route.ts |
| Return-path allowlist | Entry lib/navigation.ts |
| Session cookies and refresh | Entry lib/supabase/server.ts and proxy.ts |
| Workspace product session and data | Existing Workspace repository boundary; not replaced by this landing |

Ordinary public /login has the existing /workspaces destination chooser as its default. However, the published implementation also preserves allowlisted product handoff and OAuth continuations. A universal chooser after every deep-link or authorization continuation is not established by this change. Implementing that would require separately authorized auth-owner work. Existing product sessions remain host-scoped; this branch does not introduce a new identity or session authority or a wildcard cookie. No existing continuation/callback was redirected for landing convenience.

Live production hostname routing, deployed callback behavior and entitlement-aware sign-in have not been exercised with a real user. The exact operational release requirement is to verify the published platform landing → shared sign-in → authorized chooser → each enabled destination with the existing owners before launch. No route cutover, deployment, hosted migration, identity change or entitlement grant was performed.

## Validation and performance

Fresh `npm ci`, root typecheck, lint, 18 unit tests and the production build passed. Desktop/mobile acceptance also proves that the public CTA opens the canonical Entry `/login`, that its single credential form defaults to `/workspaces`, and that all shared sign-in CTA paths avoid product-specific continuations. The same suite covers the fictional recommendation change, scroll/pause behavior, requested playback, keyboard dismissal, reduced motion, missing media, data saver and width overflow.

Measured payload and process evidence is in frontdoor-performance.json. The latest local run transferred about 202 KiB on desktop and 177 KiB on mobile before interaction, with zero video requests. Desktop loads one 5.9 MiB hero asset after scroll; mobile scroll loads none. Phone video seeking was disabled after measurement showed high cost. The repeated small-screen run lowered GPU-process CPU time during the measured scroll from roughly 3.15 seconds to 0.55 seconds. This is CPU consumed by the GPU process, not hardware GPU utilization.

The earlier contended local run reported about 3.9 seconds desktop LCP and 11.1 seconds with 4× CPU slowdown / 1.6 Mbps / 100 ms latency. A fresh lockfile install and clean production build now report 0.532 seconds desktop and 1.024 seconds under the same throttled mobile profile. Measurement now records the LCP element: in both profiles it is the hero heading, not an image or film. Initial video requests remain zero; mobile scroll requests no hero video. This clears the reproducible local concern without changing the cinematic source. A clean deployed-preview and physical-phone check remains a production approval gate because these are synthetic local results. No hardware GPU utilization or physical-device result is claimed. The page remains usable if every film request fails.

Merge recommendation: review the dedicated branch and its creative source first. Merge/deployment and live routing verification require separate authorization; do not merge unrelated authentication branches to deliver this visual change.

Final source acceptance: fresh install, root typecheck, lint, 18/18 unit tests and production build PASS. Final production browser suite PASS 10/10 (desktop and mobile), including the canonical shared-login/chooser default. The auth-owner path diff against ef7fd32 is empty. Remotion source typecheck and all three local renders completed. No deployed-route or physical-device performance claim is made.
