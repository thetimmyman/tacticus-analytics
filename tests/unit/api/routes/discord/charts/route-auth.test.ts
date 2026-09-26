import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'ps21-route-secret-0123456789abcdef'
const BOSS = 'https://example.test/api/discord/charts/boss'

vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200
    headers = new Headers()
    constructor(_element: unknown, _options?: unknown) {}
  }
}))

const { fetchBossLeaderboardSummary, loadModes } = vi.hoisted(() => ({
  fetchBossLeaderboardSummary: vi.fn(async () => ({
    ok: true as const,
    summary: {
      guildLabel: 'Guild',
      season: '12',
      leaderboard: [{ name: 'Boss', level: 1, loop: 1, totalDamage: 10 }]
    }
  })),
  loadModes: vi.fn(async () => ['public'] as string[])
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/boss/data',
  () => ({ fetchBossLeaderboardSummary })
)

vi.mock('@/app/api/discord/charts/privacy', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/api/discord/charts/privacy')>()
  return {
    ...actual,
    resolveChartPrivacy: (
      client: Parameters<typeof actual.resolveChartPrivacy>[0],
      guild: string
    ) => actual.resolveChartPrivacy(client, guild, { loadModes })
  }
})

vi.mock('@/app/lib/db', () => ({ serviceDb: () => ({}) }))
vi.mock('@/app/api/discord/guild-label', () => ({
  resolveGuildDisplayLabel: async () => 'Guild'
}))

import { GET } from '@/app/api/discord/charts/boss/route'
import { signChartUrl } from '@/app/api/discord/charts/signed-url'

describe('PS-21 /api/discord/charts/boss auth gate', () => {
  const original = process.env.DISCORD_CHART_URL_SECRET

  beforeEach(() => {
    process.env.DISCORD_CHART_URL_SECRET = SECRET
    loadModes.mockResolvedValue(['public'])
    fetchBossLeaderboardSummary.mockClear()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DISCORD_CHART_URL_SECRET
    else process.env.DISCORD_CHART_URL_SECRET = original
  })

  it('rejects an UNSIGNED request with 401 and never touches chart data', async () => {
    const response = await GET(new Request(`${BOSS}?guild=ABCD&season=12`))
    expect(response.status).toBe(401)
    expect(fetchBossLeaderboardSummary).not.toHaveBeenCalled()
  })

  it('rejects an EXPIRED signed request with 401', async () => {
    const url = signChartUrl(`${BOSS}?guild=ABCD&season=12`, {
      ttlSeconds: -3600
    })
    const response = await GET(new Request(url))
    expect(response.status).toBe(401)
    expect(fetchBossLeaderboardSummary).not.toHaveBeenCalled()
  })

  it('rejects a TAMPERED signed request with 401', async () => {
    const url = new URL(signChartUrl(`${BOSS}?guild=ABCD&season=12`))
    url.searchParams.set('guild', 'OTHER')
    const response = await GET(new Request(url.toString()))
    expect(response.status).toBe(401)
    expect(fetchBossLeaderboardSummary).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the signing secret is unset', async () => {
    const url = signChartUrl(`${BOSS}?guild=ABCD&season=12`)
    delete process.env.DISCORD_CHART_URL_SECRET
    const response = await GET(new Request(url))
    expect(response.status).toBe(503)
    expect(fetchBossLeaderboardSummary).not.toHaveBeenCalled()
  })

  it('lets a SIGNED request through and marks the image private', async () => {
    const url = signChartUrl(`${BOSS}?guild=ABCD&season=12`)
    const response = await GET(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(fetchBossLeaderboardSummary).toHaveBeenCalledTimes(1)
  })

  it('refuses a hide_all guild with 403 even when the signature is valid', async () => {
    loadModes.mockResolvedValue(['hide_all'])
    const url = signChartUrl(`${BOSS}?guild=ABCD&season=12`)
    const response = await GET(new Request(url))
    expect(response.status).toBe(403)
    expect(fetchBossLeaderboardSummary).not.toHaveBeenCalled()
  })
})
