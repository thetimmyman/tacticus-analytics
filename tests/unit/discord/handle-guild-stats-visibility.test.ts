import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGuildStatsCommand } from '@/app/api/discord/interactions/command-handlers/handlers/boss/handle-boss-leaderboard'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  fetchBossLeaderboardSummary: vi.fn(),
  getCurrentSeason: vi.fn(),
  resolveGuildContext: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/boss/data',
  () => ({
    fetchBossLeaderboardSummary: mocks.fetchBossLeaderboardSummary
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
  async (importOriginal) => ({
    ...((await importOriginal()) as object),
    resolveGuildContext: mocks.resolveGuildContext
  })
)

const supabase = {} as unknown as Supabase

const interactionWithOptions = (
  options: Array<{ name: string; value: string | boolean }>
) =>
  ({
    guild_id: 'discord-guild-1',
    channel_id: 'channel-1',
    member: { user: { id: 'discord-user-1' } },
    data: { name: 'guild-stats', options }
  }) as unknown as CommandInteraction

const summary = {
  season: '103',
  guild: 'TEST',
  guildLabel: 'TEST - Guild TEST',
  totalDamage: 1234567,
  totalAttempts: 42,
  uniqueBosses: 6,
  leaderboard: [
    {
      name: 'Szarekh',
      level: 'Legendary',
      loop: 1,
      totalDamage: 400000,
      averageDamage: 26000,
      attempts: 15
    }
  ]
}

describe('handleGuildStatsCommand visibility (default private)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentSeason.mockResolvedValue('103')
    mocks.resolveGuildContext.mockResolvedValue({
      ok: true,
      guild: {
        guildCode: 'TEST',
        guildTag: 'TEST',
        clusterCode: 'EOT',
        displayName: 'Guild TEST'
      }
    })
    mocks.fetchBossLeaderboardSummary.mockResolvedValue({ ok: true, summary })
  })

  it('responds ephemerally when the public option is omitted', async () => {
    const response = await handleGuildStatsCommand(
      supabase,
      interactionWithOptions([])
    )

    expect(response.embeds?.[0]?.title).toBe(
      'Boss Leaderboards - TEST - Guild TEST'
    )
    expect(response.flags).toBe(64)
  })

  it('responds publicly when public is true', async () => {
    const response = await handleGuildStatsCommand(
      supabase,
      interactionWithOptions([{ name: 'public', value: true }])
    )

    expect(response.embeds?.[0]?.title).toBe(
      'Boss Leaderboards - TEST - Guild TEST'
    )
    expect(response.flags).toBeUndefined()
  })

  it('keeps errors public after a public defer', async () => {
    mocks.fetchBossLeaderboardSummary.mockResolvedValue({
      ok: false,
      message: 'No boss data found.'
    })

    const response = await handleGuildStatsCommand(
      supabase,
      interactionWithOptions([{ name: 'public', value: true }])
    )

    expect(response.embeds?.[0]?.description).toContain('No boss data found.')
    expect(response.flags).toBeUndefined()
  })

  it('keeps errors ephemeral when the command is private', async () => {
    mocks.fetchBossLeaderboardSummary.mockResolvedValue({
      ok: false,
      message: 'No boss data found.'
    })

    const response = await handleGuildStatsCommand(
      supabase,
      interactionWithOptions([])
    )

    expect(response.embeds?.[0]?.description).toContain('No boss data found.')
    expect(response.flags).toBe(64)
  })
})
