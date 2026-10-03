# Preview deployment notes

> **Status clarification - October 3, 2026:** Historical foundation/Preview procedure. Production identity and application authorities now exist; the setup checklist below must not be replayed as a current production task. Use separately approved environment-specific instructions and the canonical release-baseline gate before any release.
> Current authority: [production state](https://github.com/abostwick12/lead-emergence-control-plane/blob/main/docs/status/PRODUCTION_STATE.md) and [roadmap](https://github.com/abostwick12/lead-emergence-control-plane/blob/main/docs/ROADMAP.md).

- Use a separate Vercel preview project and a dedicated Supabase project.
- Configure `APP_ORIGIN` to the exact preview origin; never trust a request Host header for callbacks.
- Add only exact Supabase Auth redirect URLs for local and preview environments.
- Keep product URLs environment-specific and validate them server-side before redirects.
- Do not configure production DNS or aliases in this phase.
- Rollback is deleting the preview deployment and reverting the Entry project configuration; sibling products remain unchanged.

Before production: create and secure the live identity project, configure OAuth callbacks if approved, complete migration and product handoff contracts, verify all domains, and obtain explicit cutover approval.
