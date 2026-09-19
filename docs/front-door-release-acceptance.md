# Unified Entry front-door candidate

This source candidate makes Entry the public sign-in and product-choice surface.
It is independent from the Workspace trusted-provider callback and does not
weaken product admission.

- No active product: show the existing access-pending state.
- One active product: redirect only to that product's existing handoff path.
- Multiple active products: render the product-choice dialog.
- OAuth consent continues through its own allowlisted continuation path; it does
  not enter the general product picker.
- Workspace `/login` remains a handoff to Entry by default. `?legacy=1` is an
  emergency local-password rollback only; subsequent Workspace access still
  calls `ensure_personal_workspace()`, whose trusted identity, membership, plan,
  and provisioning checks remain authoritative.

Deployment prerequisites:

1. merge and validate the resource-bound MCP admission change first;
2. complete shared-Auth real-client acceptance with dynamic MCP admission
   disabled until the final service-only gate;
3. deploy Entry and Workspace front-door candidates together;
4. verify Entry signup/login, one-product auto-continue, multi-product picker,
   consent continuation, Workspace provider callback, and `?legacy=1` rollback
   without a product-admission bypass.

Local checks: unit tests 19/19, typecheck, lint, and production build passed.
No production deployment, Auth/OAuth change, or user/entitlement action is part
of this candidate.
