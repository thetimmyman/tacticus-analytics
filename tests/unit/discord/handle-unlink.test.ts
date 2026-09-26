import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleUnlinkCommand } from '@/app/api/discord/interactions/command-handlers/handlers/link'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const mocks = vi.hoisted(() => ({
  getLinkedGuilds: vi.fn(),
  guildMatchesInput: vi.fn(),
  formatGuildLabel: vi.fn()
}))

vi.mock(
  '@/app/api/discord/interactions/command-handlers/utils/guild-resolution',
  () => ({
    getLinkedGuilds: mocks.getLinkedGuilds,
    guildMatchesInput: mocks.guildMatchesInput,
    formatGuildLabel: mocks.formatGuildLabel
  })
)

vi.mock('@/app/lib/services/guild-config-service', () => ({
  GuildConfigService: {
    findByCodeOrTag: vi.fn(),
    getBasic: vi.fn()
  }
}))

const linkedGuild = (code: string) => ({
  guildCode: code,
  guildTag: code,
  clusterCode: 'EOT',
  displayName: `Guild ${code}`
})

type MutationResult = { error: { message: string } | null }

const createMutationQuery = (result: MutationResult) => {
  const query = {
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    then: <R1, R2>(
      onFulfilled?: (value: MutationResult) => R1,
      onRejected?: (reason: Error) => R2
    ) => Promise.resolve(result).then(onFulfilled, onRejected)
  }
  query.update.mockReturnValue(query)
  query.delete.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

const buildInteraction = (options: Array<{ name: string; value: string }>) =>
  ({
    guild_id: 'discord-guild-1',
    channel_id: 'channel-1',
    member: { user: { id: 'discord-user-1' } },
    data: { name: 'unlink', options }
  }) as unknown as CommandInteraction

describe('handleUnlinkCommand cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.formatGuildLabel.mockImplementation(
      (guild: { guildCode: string }) => guild.guildCode
    )
    mocks.guildMatchesInput.mockImplementation(
      (guild: { guildCode: string }, input: string) =>
        guild.guildCode === input.toUpperCase()
    )
  })

  it('requires the guild option', async () => {
    const from = vi.fn()
    const response = await handleUnlinkCommand(
      { from } as unknown as Supabase,
      buildInteraction([])
    )

    expect(response.embeds?.[0]?.title).toContain('Command Error')
    expect(response.embeds?.[0]?.description).toContain('`guild`')
    expect(from).not.toHaveBeenCalled()
  })

  it('deletes channel defaults, token reminders, AND user guild defaults for the unlinked guild', async () => {
    mocks.getLinkedGuilds.mockResolvedValue([linkedGuild('AAAAA')])

    const tables: Record<string, ReturnType<typeof createMutationQuery>> = {
      discord_server_guilds: createMutationQuery({ error: null }),
      discord_channel_guilds: createMutationQuery({ error: null }),
      discord_token_reminders: createMutationQuery({ error: null }),
      discord_user_guild_defaults: createMutationQuery({ error: null })
    }
    const from = vi.fn((table: string) => {
      const query = tables[table]
      if (!query) throw new Error(`Unexpected table: ${table}`)
      return query
    })

    const response = await handleUnlinkCommand(
      { from } as unknown as Supabase,
      buildInteraction([{ name: 'guild', value: 'AAAAA' }])
    )

    expect(response.embeds?.[0]?.title).toContain('Guild Unlinked')

    expect(tables.discord_server_guilds!.update).toHaveBeenCalledWith({
      is_active: false
    })
    expect(tables.discord_server_guilds!.eq).toHaveBeenCalledWith(
      'discord_guild_id',
      'discord-guild-1'
    )
    expect(tables.discord_server_guilds!.eq).toHaveBeenCalledWith(
      'game_guild_code',
      'AAAAA'
    )

    for (const table of [
      'discord_channel_guilds',
      'discord_token_reminders',
      'discord_user_guild_defaults'
    ]) {
      const query = tables[table]!
      expect(query.delete, `${table} delete`).toHaveBeenCalledTimes(1)
      expect(query.eq, `${table} guild id filter`).toHaveBeenCalledWith(
        'discord_guild_id',
        'discord-guild-1'
      )
      expect(query.eq, `${table} guild code filter`).toHaveBeenCalledWith(
        'game_guild_code',
        'AAAAA'
      )
    }
  })

  it('does not run cleanup deletes when deactivating the link row fails', async () => {
    mocks.getLinkedGuilds.mockResolvedValue([linkedGuild('AAAAA')])

    const tables: Record<string, ReturnType<typeof createMutationQuery>> = {
      discord_server_guilds: createMutationQuery({
        error: { message: 'update failed' }
      }),
      discord_channel_guilds: createMutationQuery({ error: null }),
      discord_token_reminders: createMutationQuery({ error: null }),
      discord_user_guild_defaults: createMutationQuery({ error: null })
    }
    const from = vi.fn((table: string) => tables[table]!)

    const response = await handleUnlinkCommand(
      { from } as unknown as Supabase,
      buildInteraction([{ name: 'guild', value: 'AAAAA' }])
    )

    expect(response.embeds?.[0]?.title).toContain('Command Error')
    expect(tables.discord_channel_guilds!.delete).not.toHaveBeenCalled()
    expect(tables.discord_token_reminders!.delete).not.toHaveBeenCalled()
    expect(tables.discord_user_guild_defaults!.delete).not.toHaveBeenCalled()
  })
})
