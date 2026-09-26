import { describe, expect, it, vi } from 'vitest'
import {
  resolveGuildContext,
  formatGuildListCapped,
  getLinkedGuilds,
  getLinkedGuildsResult
} from '@/app/api/discord/interactions/command-handlers/utils/guild-resolution'
import { asPublicResponse } from '@/app/api/discord/interactions/command-handlers/utils/response-builder'
import type {
  Supabase,
  CommandInteraction
} from '@/app/api/discord/interactions/command-handlers/types'

const interaction = {
  guild_id: 'discord-guild-1',
  channel_id: 'channel-1',
  member: { user: { id: 'discord-user-1' } },
  data: { name: 'tokens', options: [] }
} as unknown as CommandInteraction

const linkedGuild = (code: string) => ({
  guildCode: code,
  guildTag: code,
  clusterCode: 'EOT',
  displayName: `Guild ${code}`
})

const rpcRow = (
  guildCode: string,
  source: string,
  allGuilds: Array<ReturnType<typeof linkedGuild>>
) => ({
  guild_code: guildCode,
  cluster_code: 'EOT',
  display_name: `Guild ${guildCode}`,
  source,
  all_guilds: allGuilds
})

const supabaseWithRpc = (row: ReturnType<typeof rpcRow>) =>
  ({
    rpc: vi.fn().mockResolvedValue({ data: [row], error: null })
  }) as unknown as Supabase

const supabaseWithLinkRead = (result: {
  data: never[] | null
  error: { message: string } | null
}): Supabase => {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn().mockResolvedValue(result)
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return {
    from: vi.fn(() => chain)
  } as Pick<Supabase, 'from'> as Supabase
}

describe('linked-guild read outcomes', () => {
  it('distinguishes an authoritative empty result from a failed lookup', async () => {
    const empty = await getLinkedGuildsResult(
      supabaseWithLinkRead({ data: [], error: null }),
      'discord-guild-1'
    )
    const failed = await getLinkedGuildsResult(
      supabaseWithLinkRead({
        data: null,
        error: { message: 'connection reset' }
      }),
      'discord-guild-1'
    )

    expect(empty).toEqual({ ok: true, guilds: [] })
    expect(failed).toEqual({
      ok: false,
      error: { message: 'connection reset' }
    })
  })

  it('keeps the legacy array wrapper stable for bootstrap and other callers', async () => {
    const guilds = await getLinkedGuilds(
      supabaseWithLinkRead({
        data: null,
        error: { message: 'connection reset' }
      }),
      'discord-guild-1'
    )

    expect(guilds).toEqual([])
  })
})

describe('resolveGuildContext stale-default guard', () => {
  it('resolves normally when the RPC guild is in the active linked set', async () => {
    const supabase = supabaseWithRpc(
      rpcRow('AAAAA', 'user', [linkedGuild('AAAAA'), linkedGuild('BBBBB')])
    )
    const result = await resolveGuildContext(supabase, interaction)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.guild.guildCode).toBe('AAAAA')
      expect(result.source).toBe('user')
    }
  })

  it('does not serve a stale user default outside the linked set (multi-guild server)', async () => {
    // e.g. a default row surviving /unlink; honouring it exposes data on a server the guild left.
    const supabase = supabaseWithRpc(
      rpcRow('STALE', 'user', [linkedGuild('AAAAA'), linkedGuild('BBBBB')])
    )
    const result = await resolveGuildContext(supabase, interaction)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const embed = result.response.embeds?.[0]
      expect(embed?.title).toContain('Specify a Guild')
    }
  })

  it('falls back to the only linked guild when the default is stale', async () => {
    const supabase = supabaseWithRpc(
      rpcRow('STALE', 'user', [linkedGuild('AAAAA')])
    )
    const result = await resolveGuildContext(supabase, interaction)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.guild.guildCode).toBe('AAAAA')
      expect(result.source).toBe('default')
    }
  })
})

describe('formatGuildListCapped', () => {
  it('joins short lists unchanged', () => {
    const guilds = [linkedGuild('AAAAA'), linkedGuild('BBBBB')]
    expect(formatGuildListCapped(guilds)).toBe(
      'AAAAA - Guild AAAAA, BBBBB - Guild BBBBB'
    )
  })

  it('caps long lists under the Discord field limit with a "+N more" suffix', () => {
    const guilds = Array.from({ length: 100 }, (_, i) =>
      linkedGuild(`GUILD-WITH-A-VERY-LONG-CODE-${String(i).padStart(3, '0')}`)
    )
    const value = formatGuildListCapped(guilds, {
      prefix: '• ',
      separator: '\n'
    })

    expect(value.length).toBeLessThanOrEqual(1024)
    expect(value).toMatch(/…and \d+ more$/)
  })
})

describe('asPublicResponse', () => {
  it('strips the ephemeral flag so the response survives a public defer', () => {
    const response = { embeds: [{ title: 'Error' }], flags: 64 }
    expect(asPublicResponse(response)).toEqual({
      embeds: [{ title: 'Error' }]
    })
  })

  it('returns flag-less responses unchanged', () => {
    const response = { embeds: [{ title: 'OK' }] }
    expect(asPublicResponse(response)).toBe(response)
  })
})
