import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTokensCommand } from '@/app/api/discord/interactions/command-handlers/handlers/tokens/handle-tokens'
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

const interactionWithOptions = (
  options: Array<{ name: string; value: string | boolean }>
) =>
  ({
    guild_id: 'discord-guild-1',
    channel_id: 'channel-1',
    member: { user: { id: 'discord-user-1' } },
    data: { name: 'tokens', options }
  }) as unknown as CommandInteraction

describe('handleTokensCommand error visibility', () => {
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
      ok: false,
      message: 'Unable to load guild token data right now.'
    })
  })

  it('keeps token-fetch errors public when public is not disabled (default)', async () => {
    // After a public defer an ephemeral error is swallowed, so the error carries no flags.
    const response = await handleTokensCommand(
      supabase,
      interactionWithOptions([])
    )

    expect(response.embeds?.[0]?.description).toContain(
      'Unable to load guild token data right now.'
    )
    expect(response.flags).toBeUndefined()
  })

  it('keeps token-fetch errors ephemeral when public is explicitly false', async () => {
    const response = await handleTokensCommand(
      supabase,
      interactionWithOptions([{ name: 'public', value: false }])
    )

    expect(response.embeds?.[0]?.description).toContain(
      'Unable to load guild token data right now.'
    )
    expect(response.flags).toBe(64)
  })
})
