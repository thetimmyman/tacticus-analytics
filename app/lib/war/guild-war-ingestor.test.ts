import { describe, it, expect } from 'vitest'
import {
  convertRawWarPayload,
  type LokiGuildWarResponse
} from './guild-war-parser'
import { ingestGuildWar, extractStatusMembers } from './guild-war-ingestor'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

const OUR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const THEM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function makeMockClient(selectRows: Record<string, unknown[]> = {}) {
  const upserts: Record<string, unknown[]> = {}
  const updates: Record<string, unknown[]> = {}
  let zoneSeq = 0

  const client = {
    from(table: string) {
      return {
        select(_columns?: string) {
          const rows = selectRows[table] ?? []
          const chain: Record<string, unknown> = {
            eq: () => chain,
            order: () => chain,
            limit: async () => ({ data: rows, error: null }),
            then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
              resolve({ data: rows, error: null })
          }
          return chain
        },
        upsert(rows: unknown, _opts?: unknown) {
          upserts[table] = upserts[table] ?? []
          if (Array.isArray(rows)) upserts[table].push(...rows)
          else upserts[table].push(rows)
          const result = {
            select() {
              return {
                async single() {
                  return { data: { id: `zone-${++zoneSeq}` }, error: null }
                }
              }
            },
            then(resolve: (v: { error: null }) => void) {
              resolve({ error: null })
            }
          }
          return result
        },
        update(obj: unknown) {
          updates[table] = updates[table] ?? []
          updates[table].push(obj)
          const chain = {
            eq() {
              return chain
            },
            then(resolve: (v: { error: null }) => void) {
              resolve({ error: null })
            }
          }
          return chain
        }
      }
    }
  }

  return { client: client as unknown as TypedSupabaseClient, upserts, updates }
}

const legacyPayload: LokiGuildWarResponse = {
  eventResults: [
    {
      eventResponseData: {
        activityLogs: [
          {
            type: 'battleFinished',
            id: '11111111-1111-1111-1111-111111111111',
            userId: OUR,
            teamIndex: 1,
            attemptDebuff: 1,
            score: 1200,
            zone: { id: 'z-trench', type: 'Trenches1' },
            createdOn: 1_000_000,
            attacker: {
              userId: OUR,
              displayName: 'OurPlayer',
              units: [{ unitId: 'u1', remainingHPAfter: 50 }, { unitId: 'u2' }]
            },
            defender: { userId: THEM, displayName: 'ThemPlayer', units: [] }
          }
        ],
        playerData: [
          { userId: OUR, displayName: 'OurPlayer' },
          { userId: THEM, displayName: 'ThemPlayer' }
        ],
        guildData: [
          { teamIndex: 1, guildId: 'g-ours', name: 'Our Guild' },
          { teamIndex: 2, guildId: 'g-them', name: 'Enemy Guild' }
        ]
      }
    }
  ]
}

const statusPayload = {
  eventResults: [
    {
      eventResponseData: {
        guildWarStatus: {
          members: [
            {
              userId: OUR,
              displayName: 'OurPlayer',
              optedIn: true,
              totalAttemptsLeft: 7,
              score: 1200,
              role: 'leader'
            },
            {
              userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
              displayName: 'Benchwarmer',
              optedIn: false,
              totalAttemptsLeft: 10,
              score: 0
            }
          ]
        }
      }
    }
  ]
}

describe('ingestGuildWar', () => {
  it('writes matches/zones/attempts/battles/lineups + participation at parity', async () => {
    const { client, upserts } = makeMockClient()

    const wars = await convertRawWarPayload(legacyPayload, {
      guildCode: 'OURG',
      guildName: 'Our Guild',
      guildId: 'g-ours',
      previousWar: false,
      nowMs: 5_000_000,
      playerIndex: {
        ourPlayerIds: new Set([OUR]),
        playerNameMap: new Map([[OUR, 'OurPlayer']])
      }
    })
    const members = extractStatusMembers(statusPayload as never)

    const result = await ingestGuildWar(client, wars, members, {
      guildCode: 'OURG',
      guildName: 'Our Guild'
    })

    expect(result.errors).toEqual([])
    expect(result.wars).toBe(1)
    expect(result.zones).toBe(1) // one battleFinished => one zone
    expect(result.attempts).toBe(1)
    expect(result.battles).toBe(1)
    expect(result.lineups).toBeGreaterThanOrEqual(1)
    expect(result.participation).toBe(2)

    const match = upserts['guild_war_matches']![0]! as Record<string, unknown>
    expect(match.opponent_guild_name).toBe('Enemy Guild')
    expect(match.opponent_guild_id).toBe('g-them')
    expect(match.war_status).toBe('active')
    expect(match.guild_score).toBe(1200)
    expect(match).toHaveProperty('opponent_is_unknown', false)

    const battle = upserts['guild_war_battles']![0]! as Record<string, unknown>
    expect(battle.score_earned).toBe(1200)
    expect(battle.attacker_player_name).toBe('OurPlayer')
    expect(battle.is_guild_member).toBe(true)
    expect(battle.perfect_hit).toBe(false) // u2 died => not perfect
    expect(battle.attacker_lineup_id).toBeTruthy()

    const part = upserts['guild_war_participation'] as Record<string, unknown>[]
    expect(part).toHaveLength(2)
    expect(part[0]!.war_id).toBe(wars[0]!.warId)
    expect(part[1]!.opted_in).toBe(false)
  })

  it('does not call a win perfect when no attacker survival was observed', async () => {
    // All attacker HP absent: zero losses would be an artifact, not evidence.
    const unobserved = structuredClone(legacyPayload)
    const log =
      unobserved.eventResults![0]!.eventResponseData!.activityLogs![0]!
    log.attacker!.units = [{ unitId: 'u1' }, { unitId: 'u2' }]

    const { client, upserts } = makeMockClient()
    const wars = await convertRawWarPayload(unobserved, {
      guildCode: 'OURG',
      guildName: 'Our Guild',
      guildId: 'g-ours',
      previousWar: false,
      nowMs: 5_000_000,
      playerIndex: {
        ourPlayerIds: new Set([OUR]),
        playerNameMap: new Map([[OUR, 'OurPlayer']])
      }
    })
    await ingestGuildWar(client, wars, [], {
      guildCode: 'OURG',
      guildName: 'Our Guild'
    })

    const battle = upserts['guild_war_battles']![0]! as Record<string, unknown>
    expect(battle.attacker_units_lost).toBeNull()
    expect(battle.perfect_hit).toBeNull()
  })

  it('reports participation-only when no war payload is present and the guild has no match on record', async () => {
    const { client } = makeMockClient()
    const members = extractStatusMembers(statusPayload as never)
    const result = await ingestGuildWar(client, [], members, {
      guildCode: 'OURG',
      guildName: 'Our Guild'
    })
    expect(result.wars).toBe(0)
    expect(result.participation).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('attaches a status-only import to the guild active war already on record', async () => {
    const { client, upserts } = makeMockClient({
      guild_war_matches: [
        { war_id: 'war-older', war_status: 'completed', war_start_date: null },
        { war_id: 'war-live', war_status: 'active', war_start_date: null }
      ]
    })
    const members = extractStatusMembers(statusPayload as never)
    const result = await ingestGuildWar(client, [], members, {
      guildCode: 'OURG',
      guildName: 'Our Guild'
    })

    expect(result.wars).toBe(0)
    expect(result.participation).toBe(members.length)
    expect(result.errors).toEqual([])
    const part = upserts['guild_war_participation'] as Record<string, unknown>[]
    expect(part.every((row) => row.war_id === 'war-live')).toBe(true)
  })

  it('records opt-in provenance instead of defaulting unknowns to opted in', async () => {
    const { client, upserts } = makeMockClient({
      guild_war_matches: [
        { war_id: 'war-live', war_status: 'active', war_start_date: null }
      ]
    })
    const members = extractStatusMembers(statusPayload as never)
    await ingestGuildWar(client, [], members, {
      guildCode: 'OURG',
      guildName: 'Our Guild'
    })

    const part = upserts['guild_war_participation'] as Record<string, unknown>[]
    for (const row of part) {
      expect(row.opted_in_observed).toBe(typeof row.opted_in === 'boolean')
      if (row.opted_in_observed === false) expect(row.opted_in).toBeNull()
    }
  })
})
