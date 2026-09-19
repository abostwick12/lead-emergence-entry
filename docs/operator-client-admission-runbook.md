# Owner-approved Personal admission

This candidate is inactive until its Entry migration, the dependent Workspace admission-controls migration, and the `operator-clients` Edge Function have each passed their production change gate. It intentionally has no browser-accessible service credential.

## Bootstrap

After the Entry migration is applied, an authorized Entry operator performs the one-time service-only `bootstrap_entry_operator` command for one existing canonical user. The command refuses to run if any operator record already exists. The owner must establish AAL2 before using `/operator/clients`.

## Invite

The owner enters one email and an optional display name. The Edge Function resolves zero or one Auth subject through the supported Auth Admin API. It fails on ambiguous lookup, sends a branded invite only when the user does not exist, and grants `PERSONAL` only through `set_entry_product_entitlement`. The first Workspace graph is still created only by `ensure_personal_workspace()` after trusted Workspace sign-in.

## Suspend and reactivate

Suspension denies Entry admission first, then calls the Workspace service-only suspension command. That command preserves data, disconnects Workspace MCP authorizations, and revokes all private resource grants. If the Workspace command fails after Entry suspension, the action reports `SUSPENSION_PARTIAL`; this is safe-deny and requires an operator follow-up before reactivation.

Reactivation enables the Workspace Personal plan before restoring Entry `PERSONAL` admission. It does not restore an MCP authorization or private grant. The client must complete a new MCP authorization flow.

## Rollback

Do not remove either migration to roll back. Disable the Edge Function route at the deployment gate to stop new operator actions. Existing product admission and trusted Workspace provisioning remain governed by their existing checks. The durable MCP kill switch is separate: use the Workspace service-only setting command to disable dynamic MCP admission.

## Privacy

The browser receives only lifecycle state, graph state, MCP connection count, and opaque admission references. It receives no email, canonical user ID, Auth identity, token, secret, entitlement row, or Workspace content. Server audit tables store irreversible fingerprints only.
