# Handoff cryptography

Entry should sign handoff assertions with an asymmetric private key. Products receive only the public key and verify signature, issuer, audience, timestamps, nonce/JTI, and one-time redemption. This prevents a compromised product verifier from minting Entry assertions.

Claims are limited to `iss`, `sub` (canonical identity), `aud` (one product), `iat`, `exp`, and `jti`. No roles, organizations, engagements, visibility scopes, or sensitive profile data are included.

The implementation must use a key ID and key rotation plan before production. A private key is never sent to browser code or committed to the repository.
