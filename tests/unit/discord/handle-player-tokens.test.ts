import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlePlayerTokensCommand } from '@/app/api/discord/interactions/command-handlers/handlers/player/handle-player-tokens'
import type {
  CommandInteraction,
  CommandResponse
} from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  getLinkedGuilds: vi.fn(),
  fetchGuildTokens: vi.fn(),
  getCurrentSeason: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/utils/guild-resolution',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/api/discord/interactions/command-handlers/utils/guild-resolution')
      >()
    return {
      ...actual,
      getLinkedGuilds: mocks.getLinkedGuilds
    }
  }
)

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/tokens/fetch-guild-tokens',
  () => ({
    fetchGuildTokens: mocks.fetchGuildTokens
  })
)

vi.mock(
  '@/app/api/discord/interactions/command-handlers/handlers/tokens/shared',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/api/discord/interactions/command-handlers/handlers/tokens/shared')
      >()
    return {
      ...actual,
      getCurrentSeason: mocks.getCurrentSeason
    }
  }
)

const LINKED_GUILD = {
  guildCode: 'EOT',
  guildTag: 'EOT',
  displayName: 'Example Alliance',
  clusterCode: null
}

function interaction(
  options: Array<{ name: string; value: string | boolean }>
) {
  return {
    guild_id: 'discord-guild-1',
    data: { options }
  } as CommandInteraction
}

function embedText(response: CommandResponse): string {
  return JSON.stringify(response)
}

describe('handlePlayerTokensCommand (D4 on-hand rewire)', () => {
  beforeEach(() => {
    // Pin the clock: on any 28th the footer date would match the not.toContain('/28') guard.
    vi.useFakeTimers({ now: new Date('2026-07-15T12:00:00Z') })
    vi.clearAllMocks()
    mocks.getLinkedGuilds.mockResolvedValue([LINKED_GUILD])
    mocks.getCurrentSeason.mockResolvedValue('105')
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: true,
      players: [
        {
          displayName: 'Tobble',
          discordUserId: null,
          tokensAvailable: 2,
          tokensUsed: 11,
          bombsAvailable: 1,
          tokenCooldown: '4h 11m',
          tokenNextSeconds: 15060,
          bombCooldown: null
        },
        {
          displayName: 'Frodo',
          discordUserId: null,
          tokensAvailable: 0,
          tokensUsed: 14,
          bombsAvailable: 0,
          tokenCooldown: '1h 2m',
          tokenNextSeconds: 3720,
          bombCooldown: '9h 30m'
        }
      ]
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves CURRENT on-hand tokens/bombs from the shared fetchGuildTokens source', async () => {
    const response = await handlePlayerTokensCommand(
      {} as never,
      interaction([{ name: 'player', value: 'tobble' }])
    )

    expect(mocks.fetchGuildTokens).toHaveBeenCalledWith(
      {},
      'EOT',
      undefined,
      null
    )
    const text = embedText(response)
    expect(text).toContain('Tobble')
    expect(text).toContain('2/3')
    expect(text).toContain('used 11')
    expect(text).toContain('Bomb ready')
    expect(text).not.toContain('Frodo')
    expect(text).not.toContain('/28')
  })

  it('shows bomb cooldowns for players with spent bombs', async () => {
    const response = await handlePlayerTokensCommand(
      {} as never,
      interaction([{ name: 'player', value: 'frodo' }])
    )

    const text = embedText(response)
    expect(text).toContain('0/3')
    expect(text).toContain('Bomb in 9h 30m')
  })

  it('rejects guilds that are not linked to the server', async () => {
    const response = await handlePlayerTokensCommand(
      {} as never,
      interaction([
        { name: 'player', value: 'tobble' },
        { name: 'guild', value: 'NOPE' }
      ])
    )

    expect(mocks.fetchGuildTokens).not.toHaveBeenCalled()
    expect(embedText(response)).toContain('not linked')
  })

  it('surfaces the fetch failure message when every guild fails', async () => {
    mocks.fetchGuildTokens.mockResolvedValue({
      ok: false,
      message: 'Unable to load guild token data right now.'
    })

    const response = await handlePlayerTokensCommand(
      {} as never,
      interaction([{ name: 'player', value: 'tobble' }])
    )

    expect(embedText(response)).toContain(
      'Unable to load guild token data right now.'
    )
  })
})
