import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'ps21-labels-secret-0123456789abcd'
const URL_BASE = 'https://example.test/api/discord/charts/player-performance'

const { rendered, getPlayerPerformanceSummaryRPC, loadModes } = vi.hoisted(
  () => ({
    rendered: [] as unknown[],
    getPlayerPerformanceSummaryRPC: vi.fn(async () => [
      { displayName: 'RealPlayerOne', avg_vs_guild: 1.5 },
      { displayName: 'RealPlayerTwo', avg_vs_guild: -0.5 }
    ]),
    loadModes: vi.fn(async () => ['public'] as string[])
  })
)

vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200
    headers = new Headers()
    constructor(element: unknown) {
      rendered.push(element)
    }
  }
}))

vi.mock(
  '@/app/lib/calculations/experimental/player-performance-summary',
  () => ({ getPlayerPerformanceSummaryRPC })
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

import { GET } from '@/app/api/discord/charts/player-performance/route'
import { signChartUrl } from '@/app/api/discord/charts/signed-url'
import { ANONYMOUS_PLAYER_LABEL } from '@/app/api/discord/charts/privacy'

function collectLabels(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectLabels(child, out))
    return out
  }
  if (!node || typeof node !== 'object') return out
  const record = node as Record<string, unknown>
  if (typeof record.label === 'string') out.push(record.label)
  Object.values(record).forEach((value) => collectLabels(value, out))
  return out
}

describe('PS-21 player-performance chart labels honour hide_players', () => {
  const original = process.env.DISCORD_CHART_URL_SECRET

  beforeEach(() => {
    process.env.DISCORD_CHART_URL_SECRET = SECRET
    rendered.length = 0
    loadModes.mockResolvedValue(['public'])
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DISCORD_CHART_URL_SECRET
    else process.env.DISCORD_CHART_URL_SECRET = original
  })

  it('renders real names for a public guild', async () => {
    const response = await GET(
      new Request(signChartUrl(`${URL_BASE}?guild=ABCD&season=12`))
    )
    expect(response.status).toBe(200)
    const labels = collectLabels(rendered)
    expect(labels).toContain('RealPlayerOne')
    expect(labels).toContain('RealPlayerTwo')
  })

  it('replaces every per-player label for a hide_players guild', async () => {
    loadModes.mockResolvedValue(['hide_players'])
    const response = await GET(
      new Request(signChartUrl(`${URL_BASE}?guild=ABCD&season=12`))
    )
    expect(response.status).toBe(200)
    const labels = collectLabels(rendered)
    expect(labels).not.toContain('RealPlayerOne')
    expect(labels).not.toContain('RealPlayerTwo')
    expect(labels.filter((l) => l === ANONYMOUS_PLAYER_LABEL)).toHaveLength(2)
  })

  it('refuses a hide_all guild with 403 and renders nothing', async () => {
    loadModes.mockResolvedValue(['hide_all'])
    const response = await GET(
      new Request(signChartUrl(`${URL_BASE}?guild=ABCD&season=12`))
    )
    expect(response.status).toBe(403)
    expect(rendered).toHaveLength(0)
  })
})
