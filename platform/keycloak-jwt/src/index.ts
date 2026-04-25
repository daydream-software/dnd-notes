import { createPublicKey, type KeyObject, verify } from 'node:crypto'

export interface JwtHeader {
  alg?: string
  kid?: string
  typ?: string
}

export interface JwtClaims {
  aud?: string | string[]
  azp?: string
  exp?: number
  iat?: number
  iss?: string
  nbf?: number
  sub?: string
  [claim: string]: unknown
}

export type KeycloakJwtErrorCode =
  | 'malformed'
  | 'unsupported_alg'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'
  | 'jwks_fetch_failed'
  | 'jwks_key_missing'
  | 'invalid_signature'

export class KeycloakJwtVerificationError extends Error {
  readonly code: KeycloakJwtErrorCode

  constructor(code: KeycloakJwtErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'KeycloakJwtVerificationError'
    this.code = code
  }
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(`${normalized}${padding}`, 'base64')
}

export function parseJwtSection<T>(value: string): T {
  try {
    return JSON.parse(decodeBase64Url(value).toString('utf8')) as T
  } catch {
    throw new KeycloakJwtVerificationError(
      'malformed',
      'Failed to parse JWT segment.',
    )
  }
}

interface KeycloakJwk {
  kid?: string
  kty?: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

interface KeycloakJwksResponse {
  keys?: KeycloakJwk[]
}

const jwkCache = new Map<string, KeyObject>()

export function clearJwkCache(): void {
  jwkCache.clear()
}

export async function getPublicKeyForKid(
  jwksUrl: string,
  keyId: string,
): Promise<KeyObject> {
  const cacheKey = `${jwksUrl}#${keyId}`
  const cached = jwkCache.get(cacheKey)

  if (cached) {
    return cached
  }

  let response: Response

  try {
    response = await fetch(jwksUrl)
  } catch {
    throw new KeycloakJwtVerificationError(
      'jwks_fetch_failed',
      `Failed to fetch JWKS from ${jwksUrl}.`,
    )
  }

  if (!response.ok) {
    throw new KeycloakJwtVerificationError(
      'jwks_fetch_failed',
      `JWKS endpoint ${jwksUrl} returned HTTP ${response.status}.`,
    )
  }

  let payload: KeycloakJwksResponse
  try {
    payload = (await response.json()) as KeycloakJwksResponse
  } catch {
    throw new KeycloakJwtVerificationError(
      'jwks_fetch_failed',
      `JWKS endpoint ${jwksUrl} returned a non-JSON response.`,
    )
  }
  const jwk = payload.keys?.find((candidate) => candidate.kid === keyId)

  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new KeycloakJwtVerificationError(
      'jwks_key_missing',
      `JWKS at ${jwksUrl} does not contain a usable RSA key for kid=${keyId}.`,
    )
  }

  let publicKey: KeyObject
  try {
    publicKey = createPublicKey({
      key: {
        kty: 'RSA',
        kid: jwk.kid,
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    })
  } catch {
    throw new KeycloakJwtVerificationError(
      'jwks_key_missing',
      `JWKS at ${jwksUrl} contains malformed RSA key material for kid=${keyId}.`,
    )
  }
  jwkCache.set(cacheKey, publicKey)
  return publicKey
}

export interface VerifyTokenOptions {
  issuer: string
  audience: string
  jwksUrl: string
  clockSkewSec?: number
}

export interface VerifiedToken<TClaims extends JwtClaims = JwtClaims> {
  header: JwtHeader
  claims: TClaims
}

const ALLOWED_ALGS = new Set(['RS256'])

function audienceMatches(claims: JwtClaims, audience: string): boolean {
  const inAud =
    typeof claims.aud === 'string'
      ? claims.aud === audience
      : Array.isArray(claims.aud)
        ? claims.aud.includes(audience)
        : false

  if (claims.azp !== undefined) {
    return claims.azp === audience
  }

  return inAud
}

export async function verifyToken<TClaims extends JwtClaims = JwtClaims>(
  rawJwt: string,
  { issuer, audience, jwksUrl, clockSkewSec = 30 }: VerifyTokenOptions,
): Promise<VerifiedToken<TClaims>> {
  const parts = rawJwt.split('.')

  if (parts.length !== 3) {
    throw new KeycloakJwtVerificationError(
      'malformed',
      'JWT does not contain three segments.',
    )
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts
  const header = parseJwtSection<JwtHeader>(headerSegment)
  const claims = parseJwtSection<TClaims>(payloadSegment)

  if (typeof header.alg !== 'string' || !ALLOWED_ALGS.has(header.alg)) {
    throw new KeycloakJwtVerificationError(
      'unsupported_alg',
      `JWT alg "${header.alg ?? 'none'}" is not in the RS256 allowlist.`,
    )
  }

  if (typeof header.kid !== 'string' || header.kid === '') {
    throw new KeycloakJwtVerificationError(
      'malformed',
      'JWT header is missing a non-empty "kid".',
    )
  }

  if (claims.iss !== issuer) {
    throw new KeycloakJwtVerificationError(
      'wrong_issuer',
      `Issuer "${String(claims.iss)}" does not match expected "${issuer}".`,
    )
  }

  if (!audienceMatches(claims, audience)) {
    throw new KeycloakJwtVerificationError(
      'wrong_audience',
      `Token audience does not match expected "${audience}".`,
    )
  }

  const now = Math.floor(Date.now() / 1000)

  if (typeof claims.exp !== 'number' || claims.exp <= now - clockSkewSec) {
    throw new KeycloakJwtVerificationError('expired', 'JWT has expired.')
  }

  if (typeof claims.nbf === 'number' && claims.nbf > now + clockSkewSec) {
    throw new KeycloakJwtVerificationError(
      'not_yet_valid',
      'JWT nbf is in the future beyond the allowed clock skew.',
    )
  }

  const publicKey = await getPublicKeyForKid(jwksUrl, header.kid)
  const isValid = verify(
    'RSA-SHA256',
    Buffer.from(`${headerSegment}.${payloadSegment}`),
    publicKey,
    decodeBase64Url(signatureSegment),
  )

  if (!isValid) {
    throw new KeycloakJwtVerificationError(
      'invalid_signature',
      'JWT signature is invalid.',
    )
  }

  return { header, claims }
}
