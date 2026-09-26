import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTokenOverviewCommand } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/handle-token-overview'

const mocks = vi.hoisted(() => ({
  fetchGuildTokens: vi.fn(),
  getCurrentSeason: vi.fn(),
  resolveGuildContext: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/tokens/fetch-guild-tokens',
  () => ({
    fetchGuildTokens: mocks.fetchGuildTokens
  })
)

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/tokens/shared',
  async (importOriginal) => ({
    ...((await importOriginal()) as object),
    getCurrentSeason: mocks.getCurrentSeason
  })
)

vi.mock(
  '@/app/api/discord/interactions/command-handlers/utils/guild-resolution',
  () => ({
    resolveGuildContext: mocks.resolveGuildContext
  })
)

describe('handleTokenOverviewCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentSeason.mockResolvedValue('103')
    mocks.resolveGuildContext.mockResolvedValue({
      ok: true,
      guild: { guildCode: 'TEST', clusterCode: null }
    })
  })

  it('renders burned-token totals with fractional regen credit', async () => {
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: true,
      players: [
        {
          displayName: 'Leader',
          discordUserId: null,
          tokensAvailable: 1,
          tokensUsed: 11,
          bombsAvailable: 0,
          tokenCooldown: null,
          tokenNextSeconds: null,
          bombCooldown: null
        },
        {
          displayName: 'Follower',
          discordUserId: null,
          tokensAvailable: 1,
          tokensUsed: 10,
          bombsAvailable: 0,
          tokenCooldown: '6h 0m',
          tokenNextSeconds: 6 * 60 * 60,
          bombCooldown: null
        },
        {
          displayName: 'Capped',
          discordUserId: null,
          tokensAvailable: 3,
          tokensUsed: 6,
          bombsAvailable: 0,
          tokenCooldown: null,
          tokenNextSeconds: 6 * 60 * 60,
          bombCooldown: null
        }
      ]
    })

    const response = await handleTokenOverviewCommand(
      {} as any,
      {
        data: { options: [] }
      } as any
    )

    const fields = response.embeds?.[0]?.fields ?? []
    const overview = fields.find((field) => field.name === 'Overview')?.value
    const totalBurned = fields.find(
      (field) => field.name === 'Behind pace (total)'
    )
    const overviewLines = overview?.split('\n') ?? []
    const leaderLine = overviewLines.find((line) => line.includes('Leader'))
    const followerLine = overviewLines.find((line) => line.includes('Follower'))
    const cappedLine = overviewLines.find((line) => line.includes('Capped'))

    expect(response.flags).toBeUndefined()
    expect(leaderLine).toContain('on pace')
    expect(followerLine).toContain('on pace')
    expect(cappedLine).toContain('3 behind pace')
    expect(totalBurned?.value).toBe('3 🔥')
  })

  it('marks token-overview private when public is false', async () => {
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: true,
      players: [
        {
          displayName: 'Leader',
          discordUserId: null,
          tokensAvailable: 1,
          tokensUsed: 11,
          bombsAvailable: 0,
          tokenCooldown: null,
          tokenNextSeconds: null,
          bombCooldown: null
        }
      ]
    })

    const response = await handleTokenOverviewCommand(
      {} as any,
      {
        data: {
          options: [{ name: 'public', value: false }]
        }
      } as any
    )

    expect(response.flags).toBe(64)
  })
})
