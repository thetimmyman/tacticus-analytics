import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRaidStatusCommand } from '@/app/api/discord/interactions/command-handlers/handlers/raid/handle-raid-status'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  fetchRaidStatusSummary: vi.fn(),
  fetchGuildTokens: vi.fn(),
  getCurrentSeason: vi.fn(),
  resolveGuildContext: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/raid/data',
  () => ({
    fetchRaidStatusSummary: mocks.fetchRaidStatusSummary
  })
)

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
    data: { name: 'raid-status', options }
  }) as unknown as CommandInteraction

const interaction = interactionWithOptions([])

const summary = {
  season: '103',
  guild: 'TEST',
  guildLabel: 'TEST - Guild TEST',
  totalDamage: 1234567,
  totalBattles: 42,
  totalBombs: 7,
  activePlayers: 12,
  topPlayers: [{ name: 'Leader', damage: 500000, battles: 10, bombs: 2 }],
  topBosses: [{ name: 'Szarekh', damage: 400000, hits: 15 }],
  recentActivity: [],
  trend: []
}

describe('handleRaidStatusCommand token-fetch degradation', () => {
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
    mocks.fetchRaidStatusSummary.mockResolvedValue({ ok: true, summary })
  })

  it('still renders the raid summary when the token fetch throws', async () => {
    mocks.fetchGuildTokens.mockRejectedValue(
      new Error('tacticus API timed out')
    )

    const response = await handleRaidStatusCommand(supabase, interaction)

    const embed = response.embeds?.[0]
    expect(embed?.title).toBe('Raid Status - TEST - Guild TEST')
    expect(embed?.title).not.toContain('Command Error')

    const fieldNames = embed?.fields?.map((field) => field.name) ?? []
    expect(fieldNames).toContain('Overview')
    expect(fieldNames).toContain('Top Players')
    expect(fieldNames).toContain('Top Bosses')

    const readinessField = embed?.fields?.find(
      (field) => field.name === 'Raid Readiness'
    )
    expect(readinessField?.value).toBe('Token data unavailable')
  })

  it('renders the readiness section when the token fetch succeeds (control)', async () => {
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: true,
      players: [
        {
          displayName: 'Leader',
          discordUserId: null,
          tokensAvailable: 3,
          tokensUsed: 5,
          bombsAvailable: 1,
          tokenCooldown: null,
          tokenNextSeconds: null,
          bombCooldown: null
        }
      ]
    })

    const response = await handleRaidStatusCommand(supabase, interaction)

    const embed = response.embeds?.[0]
    expect(embed?.title).toBe('Raid Status - TEST - Guild TEST')

    const overviewField = embed?.fields?.find(
      (field) => field.name === 'Overview'
    )
    expect(overviewField?.value).toContain('Tokens ready: 3')
    expect(overviewField?.value).toContain('Capped players: 1')

    const readinessField = embed?.fields?.find(
      (field) => field.name === 'Raid Readiness'
    )
    expect(readinessField?.value).toContain('Leader')
  })
})

describe('handleRaidStatusCommand visibility (default private)', () => {
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
    mocks.fetchRaidStatusSummary.mockResolvedValue({ ok: true, summary })
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: false,
      message: 'Token data unavailable'
    })
  })

  it('responds ephemerally when the public option is omitted', async () => {
    const response = await handleRaidStatusCommand(supabase, interaction)

    expect(response.embeds?.[0]?.title).toBe('Raid Status - TEST - Guild TEST')
    expect(response.flags).toBe(64)
  })

  it('responds publicly when public is true', async () => {
    const response = await handleRaidStatusCommand(
      supabase,
      interactionWithOptions([{ name: 'public', value: true }])
    )

    expect(response.embeds?.[0]?.title).toBe('Raid Status - TEST - Guild TEST')
    expect(response.flags).toBeUndefined()
  })

  it('keeps errors public after a public defer', async () => {
    // After a public defer an ephemeral error is swallowed, so the error carries no flags.
    mocks.fetchRaidStatusSummary.mockResolvedValue({
      ok: false,
      message: 'No raid data found.'
    })

    const response = await handleRaidStatusCommand(
      supabase,
      interactionWithOptions([{ name: 'public', value: true }])
    )

    expect(response.embeds?.[0]?.description).toContain('No raid data found.')
    expect(response.flags).toBeUndefined()
  })

  it('keeps errors ephemeral when the command is private', async () => {
    mocks.fetchRaidStatusSummary.mockResolvedValue({
      ok: false,
      message: 'No raid data found.'
    })

    const response = await handleRaidStatusCommand(supabase, interaction)

    expect(response.embeds?.[0]?.description).toContain('No raid data found.')
    expect(response.flags).toBe(64)
  })
})
