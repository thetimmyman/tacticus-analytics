import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTimeToBurnCommand } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/handle-time-to-burn'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  fetchGuildTokens: vi.fn(),
  resolveGuildContext: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/tokens/fetch-guild-tokens',
  () => ({
    fetchGuildTokens: mocks.fetchGuildTokens
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

const interactionForPlayer = (playerQuery: string) =>
  ({
    guild_id: 'discord-guild-1',
    channel_id: 'channel-1',
    member: { user: { id: 'discord-user-1' } },
    data: {
      name: 'time-to-burn',
      options: [{ name: 'player', value: playerQuery }]
    }
  }) as unknown as CommandInteraction

const player = (displayName: string) => ({
  displayName,
  discordUserId: null,
  tokensAvailable: 1,
  tokensUsed: 2,
  bombsAvailable: 1,
  tokenCooldown: '3h 10m',
  tokenNextSeconds: 11400,
  bombCooldown: null
})

describe('handleTimeToBurnCommand name matching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveGuildContext.mockResolvedValue({
      ok: true,
      guild: {
        guildCode: 'TEST',
        guildTag: 'TEST',
        clusterCode: 'EOT',
        displayName: 'Guild TEST'
      }
    })
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: true,
      players: [player('Andy'), player('Anna'), player('Duncan')]
    })
  })

  it('rejects an ambiguous substring query and lists the matches', async () => {
    // A bare substring .find would silently pick an arbitrary first player.
    const response = await handleTimeToBurnCommand(
      supabase,
      interactionForPlayer('an')
    )

    const embed = response.embeds?.[0]
    expect(embed?.title).toContain('Command Error')
    expect(embed?.description).toContain('Multiple players match "an"')
    expect(embed?.description).toContain('Andy')
    expect(embed?.description).toContain('Anna')
  })

  it('resolves an exact name even when it is a substring of the query space', async () => {
    const response = await handleTimeToBurnCommand(
      supabase,
      interactionForPlayer('Anna')
    )

    const embed = response.embeds?.[0]
    expect(embed?.title).toBe('Time to Token Burn — Anna')
    expect(embed?.description).toContain('Player: Anna')
  })

  it('resolves a unique partial match', async () => {
    const response = await handleTimeToBurnCommand(
      supabase,
      interactionForPlayer('dunc')
    )

    const embed = response.embeds?.[0]
    expect(embed?.title).toBe('Time to Token Burn — Duncan')
    expect(embed?.description).toContain('Player: Duncan')
  })
})
