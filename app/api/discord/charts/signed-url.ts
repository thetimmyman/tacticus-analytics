import { createHmac, timingSafeEqual } from 'crypto'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('api.discord.charts.signed-url')

/**
 * Discord's media proxy fetches embeds with no interaction headers, so the URL carries the auth. `exp` is signed.
 * canonical = METHOD\nPATHNAME\nQUERY\nEXP (QUERY: params but sig/exp, encodeURIComponent k=v, sorted by
 * key then value, "&"-joined; EXP: unix seconds); sig = hex(HMAC_SHA256(DISCORD_CHART_URL_SECRET, canonical)).
 */

// Not exported: knip rejects exports with no in-repo consumer.
const CHART_SIGNATURE_PARAM = 'sig'
const CHART_EXPIRY_PARAM = 'exp'

export const CHART_URL_TTL_SECONDS = 15 * 60

export const CHART_CLOCK_SKEW_SECONDS = 60

const SECRET_ENV_VAR = 'DISCORD_CHART_URL_SECRET'

// Read per request so a rotated secret applies at once; check-env-contract needs the literal form.
function readChartSecret(): string | undefined {
  const secret = process.env.DISCORD_CHART_URL_SECRET?.trim()
  return secret ? secret : undefined
}

function canonicalQuery(searchParams: URLSearchParams): string {
  const entries: Array<[string, string]> = []
  searchParams.forEach((value, key) => {
    if (key === CHART_SIGNATURE_PARAM || key === CHART_EXPIRY_PARAM) return
    entries.push([key, value])
  })
  entries.sort((a, b) =>
    a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])
  )
  return entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&')
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function buildCanonicalString(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  expiryUnixSeconds: number
): string {
  return [
    method.toUpperCase(),
    pathname,
    canonicalQuery(searchParams),
    String(expiryUnixSeconds)
  ].join('\n')
}

function hmacHex(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
}

// timingSafeEqual throws on unequal lengths.
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export class ChartUrlSecretMissingError extends Error {
  constructor() {
    super(`${SECRET_ENV_VAR} is not configured`)
    this.name = 'ChartUrlSecretMissingError'
  }
}

export interface SignChartUrlOptions {
  method?: string
  ttlSeconds?: number
  now?: () => number
  secret?: string
}

/** Throws ChartUrlSecretMissingError when no secret is set. */
export function signChartUrl(
  url: string,
  options: SignChartUrlOptions = {}
): string {
  const secret = options.secret?.trim() || readChartSecret()
  if (!secret) throw new ChartUrlSecretMissingError()

  const method = (options.method ?? 'GET').toUpperCase()
  const ttl = options.ttlSeconds ?? CHART_URL_TTL_SECONDS
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000)
  const exp = nowSeconds + ttl

  const parsed = new URL(url)
  parsed.searchParams.delete(CHART_SIGNATURE_PARAM)
  parsed.searchParams.delete(CHART_EXPIRY_PARAM)

  const canonical = buildCanonicalString(
    method,
    parsed.pathname,
    parsed.searchParams,
    exp
  )
  const sig = hmacHex(secret, canonical)

  parsed.searchParams.set(CHART_EXPIRY_PARAM, String(exp))
  parsed.searchParams.set(CHART_SIGNATURE_PARAM, sig)
  return parsed.toString()
}

type ChartSignatureFailure =
  | 'secret_missing'
  | 'params_missing'
  | 'params_malformed'
  | 'expired'
  | 'bad_signature'

export type ChartSignatureResult =
  | { ok: true }
  | { ok: false; reason: ChartSignatureFailure; response: Response }

export interface VerifyChartSignatureOptions {
  now?: () => number
  secret?: string
  clockSkewSeconds?: number
}

function unauthorized(reason: ChartSignatureFailure): ChartSignatureResult {
  // Never say which check failed: "expired" vs "bad signature" leaks key validity.
  return {
    ok: false,
    reason,
    response: new Response('Unauthorized', {
      status: 401,
      headers: { 'Cache-Control': 'private, no-store' }
    })
  }
}

/** Fails closed (unset secret 503, bad sig 401); runs before the route's own validation. */
export function verifyChartSignature(
  request: Request,
  options: VerifyChartSignatureOptions = {}
): ChartSignatureResult {
  const secret = options.secret?.trim() || readChartSecret()
  const url = new URL(request.url)

  if (!secret) {
    logger.error(
      { endpoint: url.pathname, envVar: SECRET_ENV_VAR },
      'Discord chart URL signing secret is not configured; refusing to serve chart'
    )
    return {
      ok: false,
      reason: 'secret_missing',
      response: new Response('Chart signing is not configured', {
        status: 503,
        headers: { 'Cache-Control': 'private, no-store' }
      })
    }
  }

  const provided = url.searchParams.get(CHART_SIGNATURE_PARAM)
  const expRaw = url.searchParams.get(CHART_EXPIRY_PARAM)
  if (!provided || !expRaw) return unauthorized('params_missing')

  if (!/^\d{1,15}$/.test(expRaw.trim())) return unauthorized('params_malformed')
  const exp = Number(expRaw.trim())
  if (!Number.isSafeInteger(exp)) return unauthorized('params_malformed')

  const skew = options.clockSkewSeconds ?? CHART_CLOCK_SKEW_SECONDS
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000)
  if (nowSeconds > exp + skew) return unauthorized('expired')

  const canonical = buildCanonicalString(
    request.method || 'GET',
    url.pathname,
    url.searchParams,
    exp
  )
  const expected = hmacHex(secret, canonical)
  if (!safeEqualHex(provided, expected)) return unauthorized('bad_signature')

  return { ok: true }
}
