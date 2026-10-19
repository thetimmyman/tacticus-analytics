import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const globalConfig = {
  general: { minRecommendedAppVersions: { Windows: '1.29.21.1056' } },
  guildBoss: {
    misc: {
      firstSeasonStart: 1646128800000,
      seasonDuration: 1209600,
      bufferAfterSeasonEnd: 86400
    }
  }
}

function database(): TypedSupabaseClient {
  const chain = {
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => ({
      data: null,
      error: null
    })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
  }
  return {
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => ({ data: 1, error: null }))
  } as unknown as TypedSupabaseClient
}

it.each([undefined, 'https://provider-gateway.example.invalid/api/v1'])(
  'observes the documented raid caller at configured endpoint %s',
  async (baseUrl) => {
    if (baseUrl) vi.stubEnv('NEXT_PUBLIC_TACTICUS_API_URL', baseUrl)
    else vi.stubEnv('NEXT_PUBLIC_TACTICUS_API_URL', '')
    const wire = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ entries: [] })
    )
    vi.stubGlobal('fetch', wire)
    const { captureProviderMetrics } =
      await import('@/app/lib/network/provider-metrics')
    const { fetchGuildRaidData } = await import('@/app/lib/sync/tacticus-api')
    const observed = await captureProviderMetrics(async () => {
      const response = await fetchGuildRaidData('synthetic-key', 'synthetic')
      return response.json()
    })
    expect(wire).toHaveBeenCalledTimes(1)
    expect(String(wire.mock.calls[0]?.[0])).toBe(
      (baseUrl || 'https://api.tacticusgame.com/api/v1') + '/guildRaid'
    )
    expect(observed.metrics).toEqual({
      api_calls: 1,
      api_errors: 0,
      api_retry_count: 0
    })
  }
)

it('observes the season-timing config fetch used by raid post-processing', async () => {
  const wire = vi.fn(async () => Response.json(globalConfig))
  vi.stubGlobal('fetch', wire)
  const { captureProviderMetrics } =
    await import('@/app/lib/network/provider-metrics')
  const { getSeasonTiming } =
    await import('@/app/lib/services/season-timing-service')
  const observed = await captureProviderMetrics(() => getSeasonTiming(1))
  expect(observed.result.source).toBe('loki-globalconfig')
  expect(wire).toHaveBeenCalledTimes(1)
  expect(observed.metrics).toEqual({
    api_calls: 1,
    api_errors: 0,
    api_retry_count: 0
  })
})

it('preserves known-provider and unrelated requests when the configured base is malformed', async () => {
  vi.stubEnv('NEXT_PUBLIC_TACTICUS_API_URL', 'synthetic-invalid-url')
  const wire = vi.fn(async () => Response.json(globalConfig))
  vi.stubGlobal('fetch', wire)
  const { captureProviderMetrics, providerFetch } =
    await import('@/app/lib/network/provider-metrics')
  const { getSeasonTiming } =
    await import('@/app/lib/services/season-timing-service')
  const observed = await captureProviderMetrics(async () => {
    const timing = await getSeasonTiming(1)
    await providerFetch('https://unrelated.example.invalid/status')
    return timing
  })
  expect(observed.result.source).toBe('loki-globalconfig')
  expect(wire).toHaveBeenCalledTimes(2)
  expect(observed.metrics).toEqual({
    api_calls: 1,
    api_errors: 0,
    api_retry_count: 0
  })
})

it('observes both physical requests when a session refresh needs a build string', async () => {
  const wire = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/globalConfig')
      ? Response.json(globalConfig)
      : Response.json({ sessionId: 'synthetic-refreshed-session' })
  )
  vi.stubGlobal('fetch', wire)
  const { captureProviderMetrics } =
    await import('@/app/lib/network/provider-metrics')
  const { refreshSessionId } = await import('@/app/lib/sync/loki-session-api')
  const observed = await captureProviderMetrics(() =>
    refreshSessionId('synthetic', 'synthetic-user', 'synthetic-secret')
  )
  expect(observed.result).toBe('synthetic-refreshed-session')
  expect(wire).toHaveBeenCalledTimes(2)
  expect(observed.metrics).toEqual({
    api_calls: 2,
    api_errors: 0,
    api_retry_count: 0
  })
})

it('counts the successful members replay after session refresh as a retry', async () => {
  let replayed = false
  const wire = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/globalConfig'))
      return Response.json(globalConfig)
    const event = JSON.parse(String(init?.body)).playerEvent.playerEventType
    if (event === 'CONNECT') {
      return Response.json({ sessionId: 'synthetic-refreshed-session' })
    }
    if (!replayed) {
      replayed = true
      return new Response('invalid_session', { status: 401 })
    }
    return Response.json({
      eventResult: {
        eventResponseData: {
          guild: {
            members: [{ userId: 'synthetic-member', displayName: 'Synthetic' }]
          },
          leaderboard: { guildPosition: 0, season: '1' }
        }
      }
    })
  })
  vi.stubGlobal('fetch', wire)
  const { resolveLokiBuildString } = await import('@/app/lib/loki/build-string')
  await resolveLokiBuildString('Windows', { forceRefresh: true })
  wire.mockClear()
  const { captureProviderMetrics } =
    await import('@/app/lib/network/provider-metrics')
  const args = [
    'synthetic',
    'synthetic-guild',
    'synthetic-user',
    'synthetic-old-session',
    'synthetic-secret',
    database()
  ] as const
  const { fetchGuildMembersViaLoki } =
    await import('@/app/lib/sync/loki-guild-api')
  const observed = await captureProviderMetrics(async () =>
    fetchGuildMembersViaLoki(...args)
  )
  expect(wire).toHaveBeenCalledTimes(3)
  expect(observed.metrics).toEqual({
    api_calls: 3,
    api_errors: 1,
    api_retry_count: 1
  })
})
