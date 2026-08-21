-- Additive correction for the transitional handoff's server-to-server nonce
-- redemption path. Keep the already-applied foundation migration immutable.
grant usage on schema entry_identity to service_role;
grant execute on function entry_identity.redeem_handoff_nonce(
  uuid, entry_identity.entry_product, uuid
) to service_role;
