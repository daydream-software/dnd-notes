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

interface CachedJwksResponse {
  fetchedAtMs: number
  missingKidCheckedAtMs?: number
  payload: KeycloakJwksResponse
}

const jwkCache = new Map<string, KeyObject>()
const jwksResponseCache = new Map<string, CachedJwksResponse>()
const missingKidCache = new Map<string, number>()
const inflightJwksFetches = new Map<string, Promise<KeycloakJwksResponse>>()
const JWKS_CACHE_TTL_MS = 5_000

export function clearJwkCache(): void {
  jwkCache.clear()
  jwksResponseCache.clear()
  missingKidCache.clear()
  inflightJwksFetches.clear()
}

function getKeyCacheKey(jwksUrl: string, keyId: string): string {
  return `${jwksUrl}#${keyId}`
}

function createMissingKidError(
  jwksUrl: string,
  keyId: string,
  detail = 'does not contain a usable RSA key',
): KeycloakJwtVerificationError {
  return new KeycloakJwtVerificationError(
    'jwks_key_missing',
    `JWKS at ${jwksUrl} ${detail} for kid=${keyId}.`,
  )
}

function hasFreshNegativeCache(cacheKey: string, now: number): boolean {
  const expiresAt = missingKidCache.get(cacheKey)

  if (expiresAt === undefined) {
    return false
  }

  if (expiresAt > now) {
    return true
  }

  missingKidCache.delete(cacheKey)
  return false
}

function cacheMissingKid(cacheKey: string, now: number): void {
  missingKidCache.set(cacheKey, now + JWKS_CACHE_TTL_MS)
}

function clearMissingKidCacheForUrl(jwksUrl: string): void {
  for (const cacheKey of missingKidCache.keys()) {
    if (cacheKey.startsWith(`${jwksUrl}#`)) {
      missingKidCache.delete(cacheKey)
    }
  }
}

function buildPublicKeyFromJwk(
  jwksUrl: string,
  keyId: string,
  jwk: KeycloakJwk,
): KeyObject {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw createMissingKidError(jwksUrl, keyId)
  }

  try {
    return createPublicKey({
      key: {
        kty: 'RSA',
        kid: jwk.kid,
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    })
  } catch {
    throw createMissingKidError(
      jwksUrl,
      keyId,
      'contains malformed RSA key material',
    )
  }
}

function getPublicKeyFromCachedJwks(
  jwksUrl: string,
  keyId: string,
): KeyObject | undefined {
  const cacheKey = getKeyCacheKey(jwksUrl, keyId)
  const cachedResponse = jwksResponseCache.get(jwksUrl)
  const jwk = cachedResponse?.payload.keys?.find((candidate) => candidate.kid === keyId)

  if (!jwk) {
    return undefined
  }

  const publicKey = buildPublicKeyFromJwk(jwksUrl, keyId, jwk)
  jwkCache.set(cacheKey, publicKey)
  return publicKey
}

function markMissingKidChecked(jwksUrl: string, checkedAtMs: number): void {
  const cachedResponse = jwksResponseCache.get(jwksUrl)

  if (!cachedResponse) {
    return
  }

  cachedResponse.missingKidCheckedAtMs = checkedAtMs
}

function isFreshCachedJwks(
  cachedResponse: CachedJwksResponse | undefined,
  now: number,
): cachedResponse is CachedJwksResponse {
  return cachedResponse !== undefined && now - cachedResponse.fetchedAtMs <= JWKS_CACHE_TTL_MS
}

async function fetchJwks(jwksUrl: string): Promise<KeycloakJwksResponse> {
  const inflight = inflightJwksFetches.get(jwksUrl)

  if (inflight) {
    return inflight
  }

  const fetchPromise = (async () => {
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

    try {
      return (await response.json()) as KeycloakJwksResponse
    } catch {
      throw new KeycloakJwtVerificationError(
        'jwks_fetch_failed',
        `JWKS endpoint ${jwksUrl} returned a non-JSON response.`,
      )
    }
  })().finally(() => {
    inflightJwksFetches.delete(jwksUrl)
  })

  inflightJwksFetches.set(jwksUrl, fetchPromise)
  return fetchPromise
}

async function refreshJwks(jwksUrl: string): Promise<CachedJwksResponse> {
  const payload = await fetchJwks(jwksUrl)
  const cachedResponse: CachedJwksResponse = {
    fetchedAtMs: Date.now(),
    payload,
  }

  jwksResponseCache.set(jwksUrl, cachedResponse)
  clearMissingKidCacheForUrl(jwksUrl)
  return cachedResponse
}

export async function getPublicKeyForKid(
  jwksUrl: string,
  keyId: string,
): Promise<KeyObject> {
  const cacheKey = getKeyCacheKey(jwksUrl, keyId)
  const cached = jwkCache.get(cacheKey)

  if (cached) {
    return cached
  }

  const cachedFromResponse = getPublicKeyFromCachedJwks(jwksUrl, keyId)
  if (cachedFromResponse) {
    return cachedFromResponse
  }

  const now = Date.now()
  const cachedResponse = jwksResponseCache.get(jwksUrl)
  const hasFreshCache = isFreshCachedJwks(cachedResponse, now)
  const missingKidAlreadyChecked =
    hasFreshCache &&
    cachedResponse.missingKidCheckedAtMs !== undefined &&
    now - cachedResponse.missingKidCheckedAtMs <= JWKS_CACHE_TTL_MS

  if (hasFreshNegativeCache(cacheKey, now) || (hasFreshCache && missingKidAlreadyChecked)) {
    cacheMissingKid(cacheKey, now)
    throw createMissingKidError(jwksUrl, keyId)
  }

  const refreshedResponse = await refreshJwks(jwksUrl)
  const refreshedPublicKey = getPublicKeyFromCachedJwks(jwksUrl, keyId)

  if (refreshedPublicKey) {
    return refreshedPublicKey
  }

  markMissingKidChecked(jwksUrl, refreshedResponse.fetchedAtMs)
  cacheMissingKid(cacheKey, refreshedResponse.fetchedAtMs)
  throw createMissingKidError(jwksUrl, keyId)
}

export interface VerifyTokenOptions {
  issuer: string
  audience: string
  jwksUrl: string
  clockSkewSec?: number
  notBeforeSkewSec?: number
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

function normalizeClockSkewSec(name: string, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new KeycloakJwtVerificationError(
      'malformed',
      `Verification option "${name}" must be a finite, non-negative number.`,
    )
  }

  return value
}

export async function verifyToken<TClaims extends JwtClaims = JwtClaims>(
  rawJwt: string,
  { issuer, audience, jwksUrl, clockSkewSec, notBeforeSkewSec }: VerifyTokenOptions,
): Promise<VerifiedToken<TClaims>> {
  const expirationClockSkewSec = normalizeClockSkewSec('clockSkewSec', clockSkewSec) ?? 0
  const effectiveNotBeforeSkewSec =
    normalizeClockSkewSec('notBeforeSkewSec', notBeforeSkewSec) ?? expirationClockSkewSec
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

  if (typeof claims.exp !== 'number' || claims.exp <= now - expirationClockSkewSec) {
    throw new KeycloakJwtVerificationError('expired', 'JWT has expired.')
  }

  if (typeof claims.nbf === 'number' && claims.nbf > now + effectiveNotBeforeSkewSec) {
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
