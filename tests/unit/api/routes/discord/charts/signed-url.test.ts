import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHART_CLOCK_SKEW_SECONDS,
  CHART_URL_TTL_SECONDS,
  ChartUrlSecretMissingError,
  buildCanonicalString,
  signChartUrl,
  verifyChartSignature
} from '@/app/api/discord/charts/signed-url'

const SECRET = 'ps21-test-secret-0123456789abcdef'
const BASE = 'https://example.test/api/discord/charts/boss'

const NOW_MS = 1_760_000_000_000
const NOW_SECONDS = Math.floor(NOW_MS / 1000)
const now = () => NOW_MS

function signed(url = `${BASE}?guild=ABCD&season=12`): string {
  return signChartUrl(url, { secret: SECRET, now })
}

function verify(url: string, options: Record<string, unknown> = {}) {
  return verifyChartSignature(new Request(url), {
    secret: SECRET,
    now,
    ...options
  })
}

describe('PS-21 signed chart URLs', () => {
  const originalSecret = process.env.DISCORD_CHART_URL_SECRET

  beforeEach(() => {
    process.env.DISCORD_CHART_URL_SECRET = SECRET
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.DISCORD_CHART_URL_SECRET
    } else {
      process.env.DISCORD_CHART_URL_SECRET = originalSecret
    }
    vi.restoreAllMocks()
  })

  it('accepts a freshly signed URL', () => {
    const url = signed()
    expect(new URL(url).searchParams.get('exp')).toBe(
      String(NOW_SECONDS + CHART_URL_TTL_SECONDS)
    )
    expect(verify(url).ok).toBe(true)
  })

  it('rejects an unsigned request with 401', async () => {
    const result = verify(`${BASE}?guild=ABCD`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.reason).toBe('params_missing')
    expect(result.response.status).toBe(401)
    expect(result.response.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
  })

  it('rejects a request carrying only sig, or only exp', () => {
    const sig = new URL(signed()).searchParams.get('sig')
    const onlySig = verify(`${BASE}?guild=ABCD&sig=${sig}`)
    const onlyExp = verify(`${BASE}?guild=ABCD&exp=${NOW_SECONDS + 60}`)
    expect(onlySig.ok).toBe(false)
    expect(onlyExp.ok).toBe(false)
  })

  it('rejects an expired URL once past the skew tolerance', () => {
    const url = signed()
    const exp = Number(new URL(url).searchParams.get('exp'))

    const insideSkew = verify(url, {
      now: () => (exp + CHART_CLOCK_SKEW_SECONDS) * 1000
    })
    expect(insideSkew.ok).toBe(true)

    const outsideSkew = verify(url, {
      now: () => (exp + CHART_CLOCK_SKEW_SECONDS + 1) * 1000
    })
    expect(outsideSkew.ok).toBe(false)
    if (outsideSkew.ok) throw new Error('expected an expiry rejection')
    expect(outsideSkew.reason).toBe('expired')
    expect(outsideSkew.response.status).toBe(401)
  })

  it('rejects a tampered query parameter', () => {
    const url = new URL(signed())
    url.searchParams.set('guild', 'OTHER')
    const result = verify(url.toString())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a signature rejection')
    expect(result.reason).toBe('bad_signature')
    expect(result.response.status).toBe(401)
  })

  it('rejects an added query parameter and an extended exp', () => {
    const added = new URL(signed())
    added.searchParams.set('limit', '999')
    expect(verify(added.toString()).ok).toBe(false)

    const extended = new URL(signed())
    const exp = Number(extended.searchParams.get('exp'))
    extended.searchParams.set('exp', String(exp + 86_400))
    expect(verify(extended.toString()).ok).toBe(false)
  })

  it('rejects a malformed exp without throwing', () => {
    const url = new URL(signed())
    url.searchParams.set('exp', 'not-a-number')
    const result = verify(url.toString())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a malformed rejection')
    expect(result.reason).toBe('params_malformed')
    expect(result.response.status).toBe(401)
  })

  it('rejects a signature of a different byte length without throwing', () => {
    const url = new URL(signed())
    url.searchParams.set('sig', 'deadbeef')
    expect(() => verify(url.toString())).not.toThrow()
    expect(verify(url.toString()).ok).toBe(false)
  })

  it('fails closed with 503 when the secret is absent', () => {
    delete process.env.DISCORD_CHART_URL_SECRET
    const url = signed()
    const result = verifyChartSignature(new Request(url), { now })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a 503')
    expect(result.reason).toBe('secret_missing')
    expect(result.response.status).toBe(503)
    expect(result.response.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
  })

  it('refuses to sign when the secret is absent', () => {
    delete process.env.DISCORD_CHART_URL_SECRET
    expect(() => signChartUrl(`${BASE}?guild=ABCD`, { now })).toThrow(
      ChartUrlSecretMissingError
    )
  })

  it('rejects a URL signed with a different secret', () => {
    const url = signChartUrl(`${BASE}?guild=ABCD`, {
      secret: 'some-other-secret',
      now
    })
    expect(verify(url).ok).toBe(false)
  })

  it('is order-independent over query params', () => {
    const a = signChartUrl(`${BASE}?guild=ABCD&season=12`, {
      secret: SECRET,
      now
    })
    const exp = Number(new URL(a).searchParams.get('exp'))
    const sig = new URL(a).searchParams.get('sig')
    const reordered = `${BASE}?season=12&guild=ABCD&exp=${exp}&sig=${sig}`
    expect(verify(reordered).ok).toBe(true)
  })

  it('binds the signature to the path and the method', () => {
    const url = signed()
    const sig = new URL(url).searchParams.get('sig')
    const exp = new URL(url).searchParams.get('exp')

    const otherPath = `https://example.test/api/discord/charts/raid?guild=ABCD&season=12&exp=${exp}&sig=${sig}`
    expect(verify(otherPath).ok).toBe(false)

    const postResult = verifyChartSignature(
      new Request(url, { method: 'POST' }),
      { secret: SECRET, now }
    )
    expect(postResult.ok).toBe(false)
  })

  it('documents the canonical string shape for out-of-process signers', () => {
    const params = new URLSearchParams(
      'season=12&guild=ABCD&sig=ignored&exp=ignored'
    )
    expect(
      buildCanonicalString('get', '/api/discord/charts/boss', params, 1234)
    ).toBe('GET\n/api/discord/charts/boss\nguild=ABCD&season=12\n1234')
  })
})
