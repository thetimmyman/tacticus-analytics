// Null means ALLOW, so the check fails closed with no links; bootstrap /link commands are exempt.

import { describe, it, expect } from 'vitest'
import { checkOfficerPermission } from '@/app/api/discord/interactions/command-handlers/utils/permission-check'
import {
  UNLINKED_BOOTSTRAP_COMMANDS,
  OFFICER_ONLY_COMMANDS,
  GUILD_SCOPED_COMMAND_SCOPES
} from '@/app/api/discord/interactions/command-manifest'

type LinkRow = { game_guild_code: string | null }
type RoleRow = { role: string }
type GateRow = LinkRow | RoleRow

const makeSupabase = (opts: {
  serverGuilds?: LinkRow[]
  officerRows?: RoleRow[]
}): never => {
  const chain = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'limit']) self[m] = () => self
    self.then = (
      resolve: (v: { data: GateRow[]; error: null }) => void
    ): void => {
      if (table === 'discord_server_guilds') {
        return resolve({ data: opts.serverGuilds ?? [], error: null })
      }
      return resolve({ data: opts.officerRows ?? [], error: null })
    }
    return self
  }
  return {
    from: (table: string) => chain(table),
    rpc: async (name: string) => ({
      data:
        name === 'resolve_verified_discord_identities'
          ? (opts.officerRows ?? []).map((row, index) => ({
              mapping_id: index + 1,
              player_id: `player-${index + 1}`,
              user_id: `user-${index + 1}`,
              guild_code: opts.serverGuilds?.[0]?.game_guild_code ?? null,
              role: row.role,
              is_app_admin: false,
              ownership_attestation_id: `attestation-${index + 1}`,
              discord_user_id: '300000000000000003'
            }))
          : [],
      error: null
    })
  } as never
}

const interactionFor = (name: string): never =>
  ({
    guild_id: '100000000000000001',
    member: { user: { id: '300000000000000003' } },
    data: { name, options: [] }
  }) as never

describe('checkOfficerPermission — server with NO linked guilds', () => {
  it('DENIES an officer command that is not part of the link bootstrap', async () => {
    const supabase = makeSupabase({ serverGuilds: [] })
    const result = await checkOfficerPermission(
      supabase,
      interactionFor('unlink')
    )
    // Zero links means the check was skipped, not passed.
    expect(result).not.toBeNull()
    expect(JSON.stringify(result)).toContain('Server Not Linked')
  })

  it('ALLOWS /link through — it is what creates the first link', async () => {
    const supabase = makeSupabase({ serverGuilds: [] })
    expect(
      await checkOfficerPermission(supabase, interactionFor('link'))
    ).toBeNull()
  })

  it('ALLOWS /link-cluster through for the same reason', async () => {
    const supabase = makeSupabase({ serverGuilds: [] })
    expect(
      await checkOfficerPermission(supabase, interactionFor('link-cluster'))
    ).toBeNull()
  })

  it('DENIES when the only link row carries a NULL guild code', async () => {
    // A NULL game_guild_code becomes '', an empty code list that must still deny.
    const supabase = makeSupabase({ serverGuilds: [{ game_guild_code: null }] })
    const result = await checkOfficerPermission(
      supabase,
      interactionFor('unlink')
    )
    expect(result).not.toBeNull()
  })
})

describe('checkOfficerPermission — server WITH linked guilds', () => {
  it('allows an officer (unchanged)', async () => {
    const supabase = makeSupabase({
      serverGuilds: [{ game_guild_code: 'G1' }],
      officerRows: [{ role: 'officer' }]
    })
    expect(
      await checkOfficerPermission(supabase, interactionFor('unlink'))
    ).toBeNull()
  })

  it('denies a non-officer (unchanged)', async () => {
    const supabase = makeSupabase({
      serverGuilds: [{ game_guild_code: 'G1' }],
      officerRows: []
    })
    const result = await checkOfficerPermission(
      supabase,
      interactionFor('unlink')
    )
    expect(result).not.toBeNull()
  })
})

describe('the bootstrap exemption is narrow and manifest-declared', () => {
  it('covers exactly /link and /link-cluster', () => {
    expect([...UNLINKED_BOOTSTRAP_COMMANDS].sort()).toEqual([
      'link',
      'link-cluster'
    ])
  })

  it('every exempt command is itself officer-gated', () => {
    for (const name of UNLINKED_BOOTSTRAP_COMMANDS) {
      expect(OFFICER_ONLY_COMMANDS.has(name)).toBe(true)
    }
  })

  it('no guild-scoped command is exempt', () => {
    for (const name of UNLINKED_BOOTSTRAP_COMMANDS) {
      expect(GUILD_SCOPED_COMMAND_SCOPES[name]).toBeUndefined()
    }
  })
})
