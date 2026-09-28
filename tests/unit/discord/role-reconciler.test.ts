import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  reconcileGuildRoles,
  reconcileMemberRoles
} from '@/app/lib/discord/role-reconciler'
import { __clearBotRestBuckets } from '@/app/lib/discord/bot-rest-client'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'

// The cross-tenant guard is only observable in the URL handed to fetch.

// Must be snowflake-shaped (17-20 digits) or bot-rest-client bails before the PUT.
const GUILD_A_DISCORD = '111111111111111111' // discord_guild_id for guild_code AAAA
const GUILD_B_DISCORD = '222222222222222222' // discord_guild_id for guild_code BBBB
const ROLE_ID_A = '900000000000000001'
const ROLE_ID_B = '900000000000000002'
const DISCORD_USER_ID = '700000000000000007'

const NOW_MS = 1_700_000_000_000

interface FakeMember {
  user_id: string
  player_id: string
  display_name: string
  discord_user_id: string | null
  guild_code: string
  is_current: boolean
}

interface FakeRoleMapping {
  guild_code: string
  meta_team_slug: string
  discord_role_id: string
  enabled: boolean
}

interface FakeDiscordServerGuild {
  game_guild_code: string
  discord_guild_id: string
  is_active: boolean
  linked_at: string
}

interface FakeMetaRole {
  user_id: string
  meta_team_id: string
  source: string
}

interface FakeRosterRow {
  user_id: string
  hero_mapping_id: number | null
  rank_name: string | null
  active_ability_level: number | null
  passive_ability_level: number | null
}

interface FakeWorld {
  discordServerGuilds: FakeDiscordServerGuild[]
  scoringConfig: Record<
    string,
    {
      auto_role_assign_enabled: boolean
      auto_role_assign_tier: 'optimal' | 'strong' | 'suitable'
      tier_optimal_pct: number
      tier_strong_pct: number
      tier_suitable_pct: number
    }
  >
  members: FakeMember[]
  verifiedDiscordUserIds: string[]
  roleMappings: FakeRoleMapping[]
  metaTeams: Array<{ id: string; team_name: string }>
  rosterRows: FakeRosterRow[]
  heroMappings: Array<{ id: number; display_name: string | null }>
  bossRequirements: Array<{
    meta_team_id: string
    hero_requirements: Record<string, unknown>[]
  }>
  existingMetaRoles: FakeMetaRole[]
  latestSeason: number | null
  engagement: Array<{
    player_id: string
    meta_team: string
    token_count: number
  }>
  insertedMetaRoles: FakeMetaRole[]
  auditEvents: Record<string, unknown>[]
}

const trivialReq = (heroName: string) => ({
  hero_name: heroName,
  min_rank: null,
  min_rank_index: null,
  min_ability_active: null,
  min_ability_passive: null,
  min_ability_mythic: null,
  min_rarity: null,
  min_stars: null
})

// min_rank_index is the 0-based RANK_NAMES ladder (Diamond I = 15, Diamond III = 17).
const rankGatedReq = (
  heroName: string,
  minRankIndex: number,
  minRankLabel: string
) => ({
  ...trivialReq(heroName),
  min_rank: minRankLabel,
  min_rank_index: minRankIndex
})

const defaultWorld = (): FakeWorld => ({
  discordServerGuilds: [
    {
      game_guild_code: 'AAAA',
      discord_guild_id: GUILD_A_DISCORD,
      is_active: true,
      linked_at: '2024-01-01T00:00:00Z'
    },
    {
      game_guild_code: 'BBBB',
      discord_guild_id: GUILD_B_DISCORD,
      is_active: true,
      linked_at: '2024-01-01T00:00:00Z'
    }
  ],
  scoringConfig: {
    AAAA: {
      auto_role_assign_enabled: true,
      auto_role_assign_tier: 'suitable',
      tier_optimal_pct: 100,
      tier_strong_pct: 80,
      tier_suitable_pct: 60
    },
    BBBB: {
      auto_role_assign_enabled: true,
      auto_role_assign_tier: 'suitable',
      tier_optimal_pct: 100,
      tier_strong_pct: 80,
      tier_suitable_pct: 60
    }
  },
  members: [
    {
      user_id: 'user-1',
      player_id: 'player-1',
      display_name: 'Alice',
      discord_user_id: DISCORD_USER_ID,
      guild_code: 'AAAA',
      is_current: true
    }
  ],
  verifiedDiscordUserIds: [DISCORD_USER_ID],
  roleMappings: [
    {
      guild_code: 'AAAA',
      meta_team_slug: 'Mortarion Crushers',
      discord_role_id: ROLE_ID_A,
      enabled: true
    }
  ],
  metaTeams: [{ id: 'team-A', team_name: 'Mortarion Crushers' }],
  rosterRows: [
    {
      user_id: 'user-1',
      hero_mapping_id: 1,
      rank_name: 'Diamond 3',
      active_ability_level: 50,
      passive_ability_level: 50
    }
  ],
  heroMappings: [{ id: 1, display_name: 'Mortarion' }],
  bossRequirements: [
    { meta_team_id: 'team-A', hero_requirements: [trivialReq('Mortarion')] }
  ],
  existingMetaRoles: [],
  latestSeason: 42,
  engagement: [
    { player_id: 'player-1', meta_team: 'Mortarion Crushers', token_count: 10 }
  ],
  insertedMetaRoles: [],
  auditEvents: []
})

// Fake Supabase; unimplemented methods throw so schema drift cannot pass silently.
const makeSupabase = (world: FakeWorld): ServiceSupabaseClient => {
  const fromHandler = (table: string) => {
    const state: {
      filters: Array<{ col: string; val: unknown }>
      inFilter: { col: string; vals: readonly unknown[] } | null
    } = { filters: [], inFilter: null }

    const applyFilters = <T extends Record<string, unknown>>(rows: T[]): T[] =>
      rows.filter((row) => {
        for (const f of state.filters) {
          if (row[f.col] !== f.val) return false
        }
        if (state.inFilter) {
          if (!state.inFilter.vals.includes(row[state.inFilter.col])) {
            return false
          }
        }
        return true
      })

    const resolveRows = (): Record<string, unknown>[] => {
      switch (table) {
        case 'discord_server_guilds':
          return applyFilters(
            world.discordServerGuilds as unknown as Record<string, unknown>[]
          )
        case 'guild_roster_scoring_config': {
          const code = state.filters.find((f) => f.col === 'guild_code')
            ?.val as string | undefined
          const cfg = code ? world.scoringConfig[code] : undefined
          return cfg ? [cfg] : []
        }
        case 'player_mapping':
          return applyFilters(
            world.members as unknown as Record<string, unknown>[]
          )
        case 'herald_meta_role_mapping':
          return applyFilters(
            world.roleMappings as unknown as Record<string, unknown>[]
          )
        case 'meta_teams':
          return applyFilters(
            world.metaTeams as unknown as Record<string, unknown>[]
          )
        case 'player_roster':
          return applyFilters(
            world.rosterRows as unknown as Record<string, unknown>[]
          )
        case 'hero_mappings':
          return applyFilters(
            world.heroMappings as unknown as Record<string, unknown>[]
          )
        case 'boss_playbook_team_requirements':
          return applyFilters(
            world.bossRequirements as unknown as Record<string, unknown>[]
          )
        case 'player_meta_roles':
          return applyFilters(
            world.existingMetaRoles as unknown as Record<string, unknown>[]
          )
        default:
          throw new Error(`Unexpected .from('${table}') in reconciler test`)
      }
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        state.filters.push({ col, val })
        return builder
      },
      in: (col: string, vals: readonly unknown[]) => {
        state.inFilter = { col, vals }
        return builder
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => {
        const rows = resolveRows()
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'role_reconciliation_events') {
          world.auditEvents.push(...(Array.isArray(rows) ? rows : [rows]))
        } else {
          throw new Error(`Unexpected insert into ${table}`)
        }
        return Promise.resolve({ data: null, error: null })
      },
      upsert: (rows: FakeMetaRole | FakeMetaRole[]) => {
        if (table === 'player_meta_roles') {
          world.insertedMetaRoles.push(...(Array.isArray(rows) ? rows : [rows]))
        } else {
          throw new Error(`Unexpected upsert into ${table}`)
        }
        return Promise.resolve({ data: null, error: null })
      },
      then: (
        resolve: (v: {
          data: Record<string, unknown>[]
          error: null
        }) => unknown,
        reject?: (e: unknown) => unknown
      ) => {
        try {
          return Promise.resolve({ data: resolveRows(), error: null }).then(
            resolve,
            reject
          )
        } catch (e) {
          if (reject) return reject(e)
          throw e
        }
      }
    }
    if (table === 'role_reconciliation_events') {
      delete builder.then
    }
    return builder
  }

  const rpc = (name: string, params?: Record<string, unknown>) => {
    switch (name) {
      case 'resolve_verified_discord_identities': {
        const requested = new Set(
          Array.isArray(params?.p_discord_user_ids)
            ? (params.p_discord_user_ids as string[])
            : []
        )
        return Promise.resolve({
          data: world.members
            .filter(
              (member) =>
                member.discord_user_id &&
                requested.has(member.discord_user_id) &&
                world.verifiedDiscordUserIds.includes(member.discord_user_id)
            )
            .map((member, index) => ({
              mapping_id: index + 1,
              player_id: member.player_id,
              user_id: member.user_id,
              guild_code: member.guild_code,
              role: 'member',
              is_app_admin: false,
              ownership_attestation_id: `attestation-${index + 1}`,
              discord_user_id: member.discord_user_id
            })),
          error: null
        })
      }
      case 'get_latest_season':
        return Promise.resolve({ data: world.latestSeason, error: null })
      case 'get_player_meta_team_engagement':
        return Promise.resolve({ data: world.engagement, error: null })
      default:
        throw new Error(`Unexpected rpc('${name}') in reconciler test`)
    }
  }

  return {
    from: fromHandler,
    rpc
  } as unknown as ServiceSupabaseClient
}

interface FetchCall {
  url: string
  method: string
}

let fetchCalls: FetchCall[]

const stubFetch = (
  impl?: (url: string, init: { method: string }) => Response
) => {
  fetchCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: { method: string }) => {
      fetchCalls.push({ url: String(url), method: init.method })
      const res =
        impl?.(String(url), init) ??
        new Response(null, {
          status: 204,
          headers: {
            'X-RateLimit-Remaining': '5',
            'X-RateLimit-Reset-After': '1'
          }
        })
      return Promise.resolve(res)
    })
  )
}

const opts = (over: Record<string, unknown> = {}) => ({
  trigger_source: 'manual_resync' as const,
  nowMs: NOW_MS,
  ...over
})

describe('role-reconciler', () => {
  beforeEach(() => {
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
    __clearBotRestBuckets()
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('adds the mapped role and PUTs to Discord for a qualifying member', async () => {
    const world = defaultWorld()
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.members_evaluated).toBe(1)

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.method).toBe('PUT')
    expect(fetchCalls[0]?.url).toContain(`/members/${DISCORD_USER_ID}/`)
    expect(fetchCalls[0]?.url).toContain(`/roles/${ROLE_ID_A}`)

    expect(world.insertedMetaRoles).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        meta_team_id: 'team-A',
        source: 'auto'
      })
    ])
  })

  it('CROSS-TENANT GUARD: PUTs to the discord_guild_id that maps to the reconciled guild_code, never another tenant server', async () => {
    const world = defaultWorld()
    // user-1 is in AAAA; BBBB's own Discord server must never be addressed.
    const supabase = makeSupabase(world)

    await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(fetchCalls).toHaveLength(1)
    const url = fetchCalls[0]!.url
    expect(url).toContain(`/guilds/${GUILD_A_DISCORD}/`)
    expect(url).not.toContain(GUILD_B_DISCORD)
  })

  it("CROSS-TENANT GUARD: reconciling guild BBBB targets B's server, proving the mapping is keyed by guild_code", async () => {
    const world = defaultWorld()
    world.members = [
      {
        user_id: 'user-2',
        player_id: 'player-2',
        display_name: 'Bob',
        discord_user_id: DISCORD_USER_ID,
        guild_code: 'BBBB',
        is_current: true
      }
    ]
    world.roleMappings = [
      {
        guild_code: 'BBBB',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_B,
        enabled: true
      }
    ]
    world.rosterRows = [
      {
        user_id: 'user-2',
        hero_mapping_id: 1,
        rank_name: 'Diamond 3',
        active_ability_level: 50,
        passive_ability_level: 50
      }
    ]
    world.engagement = [
      {
        player_id: 'player-2',
        meta_team: 'Mortarion Crushers',
        token_count: 10
      }
    ]
    const supabase = makeSupabase(world)

    await reconcileGuildRoles(supabase, 'BBBB', opts())

    expect(fetchCalls).toHaveLength(1)
    const url = fetchCalls[0]!.url
    expect(url).toContain(`/guilds/${GUILD_B_DISCORD}/`)
    expect(url).toContain(`/roles/${ROLE_ID_B}`)
    expect(url).not.toContain(GUILD_A_DISCORD)
  })

  it('skips the whole run with no Discord calls when the guild has no active discord_server_guilds mapping', async () => {
    const world = defaultWorld()
    world.discordServerGuilds = world.discordServerGuilds.filter(
      (m) => m.game_guild_code !== 'AAAA'
    )
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(0)
    expect(result.members_evaluated).toBe(0)
    expect(fetchCalls).toHaveLength(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  it('skips a member with no discord_user_id (no Discord PUT, audited as skipped_no_discord_user)', async () => {
    const world = defaultWorld()
    world.members[0]!.discord_user_id = null
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(0)
    expect(result.skipped_no_discord_user).toBe(1)
    expect(fetchCalls).toHaveLength(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  it('fails closed for an unverified stored discord_user_id', async () => {
    const world = defaultWorld()
    world.verifiedDiscordUserIds = []
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(0)
    expect(result.skipped_no_discord_user).toBe(1)
    expect(fetchCalls).toHaveLength(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  it('only_user_id narrows the run to a single member', async () => {
    const world = defaultWorld()
    world.members = [
      {
        user_id: 'user-1',
        player_id: 'player-1',
        display_name: 'Alice',
        discord_user_id: DISCORD_USER_ID,
        guild_code: 'AAAA',
        is_current: true
      },
      {
        user_id: 'user-9',
        player_id: 'player-9',
        display_name: 'Eve',
        discord_user_id: '700000000000000099',
        guild_code: 'AAAA',
        is_current: true
      }
    ]
    world.rosterRows = [
      {
        user_id: 'user-1',
        hero_mapping_id: 1,
        rank_name: 'Diamond 3',
        active_ability_level: 50,
        passive_ability_level: 50
      },
      {
        user_id: 'user-9',
        hero_mapping_id: 1,
        rank_name: 'Diamond 3',
        active_ability_level: 50,
        passive_ability_level: 50
      }
    ]
    world.engagement = [
      {
        player_id: 'player-1',
        meta_team: 'Mortarion Crushers',
        token_count: 10
      },
      {
        player_id: 'player-9',
        meta_team: 'Mortarion Crushers',
        token_count: 10
      }
    ]
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(
      supabase,
      'AAAA',
      opts({ only_user_id: 'user-1' })
    )

    expect(result.members_evaluated).toBe(1)
    expect(result.roles_added).toBe(1)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toContain(`/members/${DISCORD_USER_ID}/`)
    expect(fetchCalls.some((c) => c.url.includes('700000000000000099'))).toBe(
      false
    )
    expect(world.insertedMetaRoles).toEqual([
      expect.objectContaining({ user_id: 'user-1' })
    ])
  })

  it('does not overwrite a sacred manual role (skipped_manual, no PUT, no upsert)', async () => {
    const world = defaultWorld()
    world.existingMetaRoles = [
      { user_id: 'user-1', meta_team_id: 'team-A', source: 'manual' }
    ]
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.skipped_manual).toBe(1)
    expect(result.roles_added).toBe(0)
    expect(fetchCalls).toHaveLength(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  it('counts a Discord 403 as failed and does NOT upsert a player_meta_roles row', async () => {
    const world = defaultWorld()
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: 'Missing Permissions' }), {
          status: 403
        })
    )
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(fetchCalls).toHaveLength(1)
    expect(result.failed).toBe(1)
    expect(result.roles_added).toBe(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  it('honors the auto_role_assign_enabled toggle for non-manual triggers', async () => {
    const world = defaultWorld()
    world.scoringConfig.AAAA!.auto_role_assign_enabled = false
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(
      supabase,
      'AAAA',
      opts({ trigger_source: 'post_sync' })
    )

    expect(result.roles_added).toBe(0)
    expect(fetchCalls).toHaveLength(0)
  })

  it('reconcileMemberRoles fans out to every guild the user belongs to, scoped to that user', async () => {
    const world = defaultWorld()
    world.members = [
      {
        user_id: 'user-1',
        player_id: 'player-1',
        display_name: 'Alice',
        discord_user_id: DISCORD_USER_ID,
        guild_code: 'AAAA',
        is_current: true
      },
      {
        user_id: 'user-1',
        player_id: 'player-1',
        display_name: 'Alice',
        discord_user_id: DISCORD_USER_ID,
        guild_code: 'BBBB',
        is_current: true
      }
    ]
    world.roleMappings = [
      {
        guild_code: 'AAAA',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_A,
        enabled: true
      },
      {
        guild_code: 'BBBB',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_B,
        enabled: true
      }
    ]
    const supabase = makeSupabase(world)

    const results = await reconcileMemberRoles(supabase, 'user-1', opts())

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.guild_code).sort()).toEqual(['AAAA', 'BBBB'])

    expect(fetchCalls).toHaveLength(2)
    const urlsByGuild = (gid: string) =>
      fetchCalls.find((c) => c.url.includes(`/guilds/${gid}/`))
    expect(urlsByGuild(GUILD_A_DISCORD)?.url).toContain(`/roles/${ROLE_ID_A}`)
    expect(urlsByGuild(GUILD_B_DISCORD)?.url).toContain(`/roles/${ROLE_ID_B}`)
    expect(urlsByGuild(GUILD_A_DISCORD)?.url).not.toContain(ROLE_ID_B)
    expect(urlsByGuild(GUILD_B_DISCORD)?.url).not.toContain(ROLE_ID_A)
  })

  it('skips a candidate below the engagement floor (capability met but no battle history) — no PUT', async () => {
    const world = defaultWorld()
    world.engagement = []
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(0)
    expect(result.skipped_threshold_not_met).toBe(1)
    expect(fetchCalls).toHaveLength(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  // rank_name is Roman-numeral and must resolve to the same RANK_NAMES index as min_rank_index.
  it('REGRESSION (rank-gated): assigns the role when the member meets min_rank_index with a Roman-numeral rank_name', async () => {
    const world = defaultWorld()
    world.bossRequirements = [
      {
        meta_team_id: 'team-A',
        hero_requirements: [rankGatedReq('Mortarion', 15, 'Diamond I')]
      }
    ]
    world.rosterRows = [
      {
        user_id: 'user-1',
        hero_mapping_id: 1,
        rank_name: 'Diamond III',
        active_ability_level: 50,
        passive_ability_level: 50
      }
    ]
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(1)
    expect(result.skipped_threshold_not_met).toBe(0)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toContain(`/roles/${ROLE_ID_A}`)
    expect(world.insertedMetaRoles).toEqual([
      expect.objectContaining({ user_id: 'user-1', meta_team_id: 'team-A' })
    ])
  })

  // Per-stage duplicate mappings for one meta team must occupy ONE top-N slot.
  it('REGRESSION (per-stage dedup): duplicate mappings for one team occupy ONE top-N slot; a second team still qualifies and ALL stage roles are PUT', async () => {
    const ROLE_ID_A2 = '900000000000000003'
    const ROLE_ID_C = '900000000000000004'
    const world = defaultWorld()
    world.roleMappings = [
      {
        guild_code: 'AAAA',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_A,
        enabled: true
      },
      {
        guild_code: 'AAAA',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_A2,
        enabled: true
      },
      {
        guild_code: 'AAAA',
        meta_team_slug: 'Bellator Boys',
        discord_role_id: ROLE_ID_C,
        enabled: true
      }
    ]
    world.metaTeams = [
      { id: 'team-A', team_name: 'Mortarion Crushers' },
      { id: 'team-C', team_name: 'Bellator Boys' }
    ]
    world.heroMappings = [
      { id: 1, display_name: 'Mortarion' },
      { id: 2, display_name: 'Bellator' }
    ]
    world.rosterRows = [
      {
        user_id: 'user-1',
        hero_mapping_id: 1,
        rank_name: 'Diamond 3',
        active_ability_level: 50,
        passive_ability_level: 50
      },
      {
        user_id: 'user-1',
        hero_mapping_id: 2,
        rank_name: 'Diamond 3',
        active_ability_level: 50,
        passive_ability_level: 50
      }
    ]
    world.bossRequirements = [
      { meta_team_id: 'team-A', hero_requirements: [trivialReq('Mortarion')] },
      { meta_team_id: 'team-C', hero_requirements: [trivialReq('Bellator')] }
    ]
    world.engagement = [
      {
        player_id: 'player-1',
        meta_team: 'Mortarion Crushers',
        token_count: 10
      },
      { player_id: 'player-1', meta_team: 'Bellator Boys', token_count: 10 }
    ]
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(2)
    expect(result.failed).toBe(0)
    const putRoleIds = fetchCalls.map((c) => c.url.match(/\/roles\/(\d+)/)?.[1])
    expect(fetchCalls).toHaveLength(3)
    expect(putRoleIds).toContain(ROLE_ID_A)
    expect(putRoleIds).toContain(ROLE_ID_A2)
    expect(putRoleIds).toContain(ROLE_ID_C)
    expect(world.insertedMetaRoles).toHaveLength(2)
    expect(world.insertedMetaRoles.map((r) => r.meta_team_id).sort()).toEqual([
      'team-A',
      'team-C'
    ])
  })

  it("when one of a team's multiple stage-role PUTs fails, no player_meta_roles row is written so the next run retries", async () => {
    const ROLE_ID_A2 = '900000000000000003'
    const world = defaultWorld()
    world.roleMappings = [
      {
        guild_code: 'AAAA',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_A,
        enabled: true
      },
      {
        guild_code: 'AAAA',
        meta_team_slug: 'Mortarion Crushers',
        discord_role_id: ROLE_ID_A2,
        enabled: true
      }
    ]
    stubFetch((url) =>
      url.includes(`/roles/${ROLE_ID_A2}`)
        ? new Response(JSON.stringify({ message: 'Missing Permissions' }), {
            status: 403
          })
        : new Response(null, {
            status: 204,
            headers: {
              'X-RateLimit-Remaining': '5',
              'X-RateLimit-Reset-After': '1'
            }
          })
    )
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(fetchCalls).toHaveLength(2)
    expect(result.failed).toBe(1)
    expect(result.roles_added).toBe(0)
    // No row: skipped_already_present must not block retrying the failed role.
    expect(world.insertedMetaRoles).toHaveLength(0)
  })

  it('REGRESSION (rank-gated): skips the role when the member is below min_rank_index (comparison is real, not always-pass)', async () => {
    const world = defaultWorld()
    world.bossRequirements = [
      {
        meta_team_id: 'team-A',
        hero_requirements: [rankGatedReq('Mortarion', 17, 'Diamond III')]
      }
    ]
    world.rosterRows = [
      {
        user_id: 'user-1',
        hero_mapping_id: 1,
        rank_name: 'Gold I',
        active_ability_level: 50,
        passive_ability_level: 50
      }
    ]
    const supabase = makeSupabase(world)

    const result = await reconcileGuildRoles(supabase, 'AAAA', opts())

    expect(result.roles_added).toBe(0)
    expect(result.skipped_threshold_not_met).toBe(1)
    expect(fetchCalls).toHaveLength(0)
    expect(world.insertedMetaRoles).toHaveLength(0)
  })
})
