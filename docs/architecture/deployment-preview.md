# Preview deployment notes

- Use a separate Vercel preview project and a dedicated Supabase project.
- Configure `APP_ORIGIN` to the exact preview origin; never trust a request Host header for callbacks.
- Add only exact Supabase Auth redirect URLs for local and preview environments.
- Keep product URLs environment-specific and validate them server-side before redirects.
- Do not configure production DNS or aliases in this phase.
- Rollback is deleting the preview deployment and reverting the Entry project configuration; sibling products remain unchanged.

Before production: create and secure the live identity project, configure OAuth callbacks if approved, complete migration and product handoff contracts, verify all domains, and obtain explicit cutover approval.
