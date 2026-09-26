import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePlayerStatsCommand } from '@/app/api/discord/interactions/command-handlers/handlers/player/handle-player-stats'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  fetchPlayerStatsSummary: vi.fn(),
  getLinkedGuilds: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/player/data',
  () => ({
    fetchPlayerStatsSummary: mocks.fetchPlayerStatsSummary
  })
)

vi.mock(
  '@/app/api/discord/interactions/command-handlers/utils/guild-resolution',
  async (importOriginal) => ({
    ...((await importOriginal()) as object),
    getLinkedGuilds: mocks.getLinkedGuilds
  })
)

const supabase = {} as unknown as Supabase

// Only /stats registers the `public` option; /player-stats always stays ephemeral.
const interactionWithOptions = (
  options: Array<{ name: string; value: string | boolean }>
) =>
  ({
    guild_id: 'discord-guild-1',
    channel_id: 'channel-1',
    member: { user: { id: 'discord-user-1' } },
    data: { name: 'stats', options }
  }) as unknown as CommandInteraction

const summary = {
  season: '103',
  guild: 'TEST',
  guildLabel: 'TEST - Guild TEST',
  displayName: 'TestPlayerA',
  totalDamage: 500000,
  totalBattles: 10,
  totalBombs: 2,
  uniqueBosses: 4,
  topBoss: null,
  biggestHit: null,
  bossBreakdown: [
    { name: 'Szarekh', totalDamage: 400000, battles: 8, bombs: 1 }
  ]
}

describe('handlePlayerStatsCommand visibility (default private)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLinkedGuilds.mockResolvedValue([
      {
        guildCode: 'TEST',
        guildTag: 'TEST',
        clusterCode: 'EOT',
        displayName: 'Guild TEST'
      }
    ])
    mocks.fetchPlayerStatsSummary.mockResolvedValue({ ok: true, summary })
  })

  it('responds ephemerally when the public option is omitted', async () => {
    const response = await handlePlayerStatsCommand(
      supabase,
      interactionWithOptions([{ name: 'player', value: 'TestPlayerA' }])
    )

    expect(response.embeds?.[0]?.title).toBe('Player Stats - TestPlayerA')
    expect(response.flags).toBe(64)
  })

  it('responds publicly when public is true', async () => {
    const response = await handlePlayerStatsCommand(
      supabase,
      interactionWithOptions([
        { name: 'player', value: 'TestPlayerA' },
        { name: 'public', value: true }
      ])
    )

    expect(response.embeds?.[0]?.title).toBe('Player Stats - TestPlayerA')
    expect(response.flags).toBeUndefined()
  })

  it('keeps errors public after a public defer', async () => {
    mocks.fetchPlayerStatsSummary.mockResolvedValue({
      ok: false,
      message: 'No player found.'
    })

    const response = await handlePlayerStatsCommand(
      supabase,
      interactionWithOptions([
        { name: 'player', value: 'TestPlayerA' },
        { name: 'public', value: true }
      ])
    )

    expect(response.embeds?.[0]?.description).toContain('No player found.')
    expect(response.flags).toBeUndefined()
  })

  it('keeps errors ephemeral when the command is private', async () => {
    mocks.fetchPlayerStatsSummary.mockResolvedValue({
      ok: false,
      message: 'No player found.'
    })

    const response = await handlePlayerStatsCommand(
      supabase,
      interactionWithOptions([{ name: 'player', value: 'TestPlayerA' }])
    )

    expect(response.embeds?.[0]?.description).toContain('No player found.')
    expect(response.flags).toBe(64)
  })
})
