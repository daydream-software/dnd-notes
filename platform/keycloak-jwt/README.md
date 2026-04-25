# @dnd-notes/keycloak-jwt

Shared private workspace package that provides the Keycloak JWT verification
primitives used by the tenant API and the control plane:

- `decodeBase64Url`, `parseJwtSection`, `normalizeBaseUrl` helpers
- An in-process JWK cache and `getPublicKeyForKid(jwksUrl, kid)` loader that
  honours the `jwksUrl` passed in (preserving each consumer's `JWKS_URL`
  override behaviour)
- `verifyToken(rawJwt, { issuer, audience, jwksUrl, clockSkewSec? })` which
  enforces the RS256 alg allowlist, issuer/audience match (with the same
  Keycloak `azp`-takes-precedence semantics as before), `exp`/`nbf` checks,
  and the JWKS-backed signature verification.

Consumer-specific identity mapping (e.g. extracting `email`/`sub`/role claims,
mapping to a tenant or workforce identity) intentionally stays in the calling
service. The shared module only throws `KeycloakJwtVerificationError`; each
consumer translates that into its own public error class.
