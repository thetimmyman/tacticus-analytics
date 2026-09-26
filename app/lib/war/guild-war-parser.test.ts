import { describe, it, expect } from 'vitest'
import {
  buildZonesFromActivityLogs,
  calculateWarScores,
  calculateScoresFromZones,
  computeSeasonAndWarNumber,
  computeSeasonAndWarNumberFromStart,
  currentGwSeason,
  formatZoneDisplayName,
  GW_SEASON_ANCHOR_SEASON,
  buildLineupId,
  computePerfectHit,
  computeFailedHit,
  extractBattlefieldLevelFromActivityLogs,
  extractLogTimestamps,
  extractGuildWarSnapshotCandidates,
  summarizeUnits,
  convertRawWarPayload,
  generateDeterministicId,
  type GuildWarActivityLog,
  type LokiGuildWarResponse,
  type WarConvertContext
} from './guild-war-parser'

const OUR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const THEM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ourIds = new Set([OUR.toLowerCase()])
const nameMap = new Map<string, string>([
  [OUR.toLowerCase(), 'OurPlayer'],
  [THEM.toLowerCase(), 'ThemPlayer']
])

const logs: GuildWarActivityLog[] = [
  {
    type: 'playerClaimedZone',
    userId: OUR,
    teamIndex: 1,
    zone: { id: 'z-trench', type: 'Trenches1' }
  },
  {
    type: 'battleFinished',
    id: 'battle-1',
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
  },
  {
    type: 'battleFinished',
    id: 'battle-2',
    userId: THEM,
    teamIndex: 2,
    score: 800,
    zone: { id: 'z-hq', type: 'HQ' },
    createdOn: 2_000_000,
    attacker: { userId: THEM, displayName: 'ThemPlayer', units: [] }
  }
]

describe('buildZonesFromActivityLogs', () => {
  it('reconstructs zones, assignments and attempts from activity logs', () => {
    const zones = buildZonesFromActivityLogs(logs, nameMap, ourIds, 1)
    expect(zones).toHaveLength(2)

    const trench = zones.find((z) => z.zoneType === 'Trenches1')!
    expect(trench.zoneName).toBe('Left Frontline')
    expect(trench.assignedPlayers).toContain('OurPlayer')
    expect(trench.attempts).toHaveLength(1)
    expect(trench.status).toBe('in_progress')

    const attempt = trench.attempts[0]!
    expect(attempt.playerId).toBe(OUR)
    expect(attempt.scoreEarned).toBe(1200)
    expect(attempt.result).toBe('win')
    expect(attempt.isGuildMember).toBe(true)
    expect(attempt.attemptNumber).toBe(1)
    // Survivor-only HP: u2 omits remainingHPAfter, so it is dead.
    expect(attempt.battlePayload?.battleSummary.attacker.unitsSurvived).toBe(1)
    expect(attempt.battlePayload?.battleSummary.attacker.unitsLost).toBe(1)

    const hq = zones.find((z) => z.zoneType === 'HQ')!
    expect(hq.attempts[0]!.isGuildMember).toBe(false)
  })
})

describe('score calculation', () => {
  it('attributes scores by teamIndex (calculateWarScores)', () => {
    const { ourScore, opponentScore } = calculateWarScores(logs, 1, ourIds)
    expect(ourScore).toBe(1200)
    expect(opponentScore).toBe(800)
  })

  it('attributes scores by roster (calculateScoresFromZones)', () => {
    const zones = buildZonesFromActivityLogs(logs, nameMap, ourIds, 1)
    const { ourScore, opponentScore } = calculateScoresFromZones(zones, ourIds)
    expect(ourScore).toBe(1200)
    expect(opponentScore).toBe(800)
  })

  it('prefers teamIndex over roster in calculateScoresFromZones (LQTTH 2026-07-25)', () => {
    // A roster-lagged own player with our teamIndex must not be credited to the opponent.
    const zones = buildZonesFromActivityLogs(
      logs,
      nameMap,
      new Set<string>(),
      1
    )
    const { ourScore, opponentScore } = calculateScoresFromZones(
      zones,
      new Set<string>(), // empty roster: only teamIndex can attribute sides
      1
    )
    expect(ourScore).toBe(1200)
    expect(opponentScore).toBe(800)

    // Unknown ourTeamIndex (0/undefined) falls back to roster membership.
    const fallback = calculateScoresFromZones(zones, ourIds, 0)
    expect(fallback.ourScore).toBe(1200)
    expect(fallback.opponentScore).toBe(800)
  })
})

describe('pure helpers', () => {
  it('computeSeasonAndWarNumber maps eventId into 6-war seasons', () => {
    expect(computeSeasonAndWarNumber(1)).toEqual({ season: 1, warNumber: 1 })
    expect(computeSeasonAndWarNumber(6)).toEqual({ season: 1, warNumber: 6 })
    expect(computeSeasonAndWarNumber(7)).toEqual({ season: 2, warNumber: 1 })
    expect(computeSeasonAndWarNumber(0)).toEqual({
      season: 0,
      warNumber: undefined
    })
  })

  it('computeSeasonAndWarNumberFromStart maps war starts onto the global calendar (WI-6260)', () => {
    // Anchor: season 25 war 1 starts at the timestamp below, as the game UI shows.
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2026-07-08T09:00:00Z'))
    ).toEqual({ season: 25, warNumber: 1 })
    // war_start_date is the first logged action, so it jitters.
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2026-07-12T21:30:06Z'))
    ).toEqual({ season: 25, warNumber: 2 })
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2026-06-17T21:37:07Z'))
    ).toEqual({ season: 24, warNumber: 6 })
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2026-02-18T09:35:05Z'))
    ).toEqual({ season: 21, warNumber: 1 })
    // A 12.7h-late first log still snaps to war 4.
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2026-04-04T09:44:22Z'))
    ).toEqual({ season: 22, warNumber: 4 })
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2026-08-12T09:00:00Z'))
    ).toEqual({ season: 26, warNumber: 1 })
    expect(
      computeSeasonAndWarNumberFromStart(Date.parse('2025-12-01T09:00:00Z'))
    ).toEqual({ season: 0, warNumber: undefined })
    expect(computeSeasonAndWarNumberFromStart(undefined)).toEqual({
      season: 0,
      warNumber: undefined
    })
  })

  /** The anchor must never come from `last_successful_gw_season` (a per-guild ratchet). */
  it('pins the season calendar to the IN-GAME numbers (WI-6270)', () => {
    const inGame = (iso: string) =>
      computeSeasonAndWarNumberFromStart(Date.parse(iso)).season

    expect(inGame('2026-08-11T12:00:00Z')).toBe(25)
    expect(inGame('2026-08-12T09:00:00Z')).toBe(26)

    expect(
      [
        '2026-02-18T09:00:00Z',
        '2026-03-25T09:00:00Z',
        '2026-04-29T09:00:00Z',
        '2026-06-03T09:00:00Z',
        '2026-07-08T09:00:00Z'
      ].map(inGame)
    ).toEqual([21, 22, 23, 24, 25])

    // 76 was the wrong value and would run 51 seasons ahead of the game.
    expect(GW_SEASON_ANCHOR_SEASON).toBe(25)
    expect(currentGwSeason(Date.parse('2026-08-11T12:00:00Z'))).toBe(25)
    expect(currentGwSeason(Date.parse('2026-08-12T09:00:00Z'))).toBe(26)
  })

  it('formatZoneDisplayName returns canonical game names and never leaks a raw id', () => {
    expect(formatZoneDisplayName('Trenches2')).toBe('Mid Frontline')
    expect(formatZoneDisplayName('HQ')).toBe('Headquarters')
    expect(formatZoneDisplayName('Bunker1')).toBe('Fortified Position 1')
    expect(formatZoneDisplayName('MysteryZone')).toBe('Mystery Zone')
    expect(formatZoneDisplayName('')).toBe('Unknown Zone')
  })

  it('buildLineupId is order-independent and deterministic', () => {
    const a = buildLineupId([{ unitId: 'x' }, { unitId: 'y' }])
    const b = buildLineupId([{ unitId: 'y' }, { unitId: 'x' }])
    expect(a).toBe(b)
    expect(a).not.toBeNull()
    expect(buildLineupId('not-an-array')).toBeNull()
    expect(buildLineupId([])).toBeNull()
  })

  it('computePerfectHit / computeFailedHit classify outcomes', () => {
    expect(computePerfectHit(0, 'win')).toBe(true)
    expect(computePerfectHit(1, 'win')).toBe(false)
    expect(computePerfectHit(null, 'win')).toBeNull()
    expect(computeFailedHit('loss', 100)).toBe(true)
    expect(computeFailedHit('win', 0)).toBe(true)
    expect(computeFailedHit('win', 100)).toBe(false)
  })

  it('extractBattlefieldLevelFromActivityLogs takes the latest selection', () => {
    const bfLogs = [
      { type: 'battlefieldSelected', battlefieldLevel: 3, createdOn: 10 },
      { type: 'battlefieldSelected', battlefieldLevel: 7, createdOn: 50 }
    ] as unknown as GuildWarActivityLog[]
    expect(extractBattlefieldLevelFromActivityLogs(bfLogs)).toBe(7)
  })

  it('extractLogTimestamps returns the min/max createdOn as ISO', () => {
    const ts = extractLogTimestamps(logs)
    expect(ts.start).toBe(new Date(1_000_000).toISOString())
    expect(ts.end).toBe(new Date(2_000_000).toISOString())
  })

  it('summarizeUnits infers dead units from missing HP when survivors present', () => {
    const summary = summarizeUnits([
      { unitId: 'a', remainingHPAfter: 10 },
      { unitId: 'b' }
    ])
    expect(summary.alive).toBe(1)
    expect(summary.dead).toBe(1)
  })

  it('generateDeterministicId is stable and UUID-shaped', async () => {
    const a = await generateDeterministicId('same-input')
    const b = await generateDeterministicId('same-input')
    const c = await generateDeterministicId('other-input')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('extractGuildWarSnapshotCandidates pulls guildWarEvent modules', () => {
    const payload: LokiGuildWarResponse = {
      player: {
        hero: {
          liveEvents: {
            liveEvents: [
              {
                startsOn: 100,
                endsOn: 200,
                modules: [
                  {
                    module: {
                      moduleType: 'guildWarEvent',
                      uuid: 'war-uuid-1',
                      lastGuildWarEventId: 7
                    }
                  },
                  { module: { moduleType: 'somethingElse' } }
                ]
              }
            ]
          }
        }
      }
    } as unknown as LokiGuildWarResponse
    const candidates = extractGuildWarSnapshotCandidates(payload)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.warUuid).toBe('war-uuid-1')
    expect(candidates[0]!.startsOn).toBe(100)
  })
})

describe('convertRawWarPayload', () => {
  const baseCtx: WarConvertContext = {
    guildCode: 'OURG',
    guildName: 'Our Guild',
    guildId: 'g-ours',
    previousWar: true,
    nowMs: 5_000_000,
    playerIndex: {
      ourPlayerIds: new Set([OUR.toLowerCase()]),
      playerNameMap: new Map([[OUR.toLowerCase(), 'OurPlayer']])
    }
  }

  it('legacy path: assembles a war from eventResults activity logs', async () => {
    const payload: LokiGuildWarResponse = {
      eventResults: [
        {
          eventResponseData: {
            activityLogs: logs,
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

    const wars = await convertRawWarPayload(payload, baseCtx)
    expect(wars).toHaveLength(1)
    const war = wars[0]!
    expect(war.guildCode).toBe('OURG')
    expect(war.opponentGuildName).toBe('Enemy Guild')
    expect(war.opponentGuildCode).toBe('g-them')
    expect(war.status).toBe('completed')
    expect(war.result).toBe('win') // 1200 our vs 800 them
    expect(war.guildScore).toBe(1200)
    expect(war.opponentScore).toBe(800)
    expect(war.ourTeamIndex).toBe(1)
    expect(war.zones?.length).toBe(2)
    const again = await convertRawWarPayload(payload, baseCtx)
    expect(again[0]!.warId).toBe(war.warId)
  })

  it('legacy path: finds activity logs behind an unrelated event result', async () => {
    // Batched LOKI responses can carry another event first.
    const payload = {
      eventResults: [
        { eventResponseData: { activityLogs: [] } },
        {
          eventResponseData: {
            activityLogs: logs,
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
    } as unknown as LokiGuildWarResponse

    const wars = await convertRawWarPayload(payload, baseCtx)
    expect(wars).toHaveLength(1)
    expect(wars[0]!.opponentGuildName).toBe('Enemy Guild')
  })

  it('legacy path: an empty player_mapping does not make the opponent our guild', async () => {
    // playerData lists both guilds; it must not be treated as our roster.
    const payload: LokiGuildWarResponse = {
      eventResults: [
        {
          eventResponseData: {
            activityLogs: logs,
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

    const wars = await convertRawWarPayload(payload, {
      ...baseCtx,
      playerIndex: {
        ourPlayerIds: new Set<string>(),
        playerNameMap: new Map<string, string>()
      }
    })

    const war = wars[0]!
    expect(war.ourTeamIndex).toBe(1) // from guildData, not the first battle
    const ours = war.zones?.find((z) => z.zoneType === 'Trenches1')
    const theirs = war.zones?.find((z) => z.zoneType === 'HQ')
    expect(ours?.attempts[0]?.isGuildMember).toBe(true)
    expect(theirs?.attempts[0]?.isGuildMember).toBe(false)
  })

  it('legacy path: marks an old war completed even when previousWar is false (WI-6230)', async () => {
    const payload: LokiGuildWarResponse = {
      eventResults: [
        {
          eventResponseData: {
            activityLogs: logs,
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

    const wars = await convertRawWarPayload(payload, {
      ...baseCtx,
      previousWar: false,
      nowMs: 1_000_000 + 60 * 60 * 60 * 1000 + 1
    })
    expect(wars[0]!.status).toBe('completed')
    expect(wars[0]!.result).toBe('win')

    const live = await convertRawWarPayload(payload, {
      ...baseCtx,
      previousWar: false,
      nowMs: 5_000_000
    })
    expect(live[0]!.status).toBe('active')
    expect(live[0]!.result).toBeUndefined()
  })

  it('legacy path: returns [] when there are no activity logs', async () => {
    const payload: LokiGuildWarResponse = {
      eventResults: [{ eventResponseData: { activityLogs: [] } }]
    }
    expect(await convertRawWarPayload(payload, baseCtx)).toEqual([])
  })

  it('snapshot path: builds zones from the defendingFrontLine grid and uses currentScore', async () => {
    const payload: LokiGuildWarResponse = {
      player: {
        hero: {
          liveEvents: {
            liveEvents: [
              {
                startsOn: 4_000_000,
                endsOn: 6_000_000, // endsOn > nowMs(5M) => active => status 'active'
                modules: [
                  {
                    module: {
                      moduleType: 'guildWarEvent',
                      uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
                      lastGuildWarEventId: 7,
                      personalState: { teamIndex: 1 },
                      team1: {
                        currentScore: 4242,
                        desiredBattlefieldLevel: 5,
                        guildWarGuildData: {
                          guildName: 'Our Guild',
                          guildId: 'g-ours',
                          members: [{ userId: OUR, displayName: 'OurPlayer' }]
                        },
                        defendingFrontLine: {
                          warZones: [
                            [
                              {
                                zoneId: 'z1',
                                warZoneType: 'Trenches1',
                                zonePart1: { occupiedByUserId: OUR }
                              }
                            ]
                          ]
                        }
                      },
                      team2: {
                        currentScore: 999,
                        guildWarGuildData: {
                          guildName: 'Enemy Guild',
                          guildId: 'g-them',
                          members: [{ userId: THEM, displayName: 'ThemPlayer' }]
                        },
                        defendingFrontLine: { warZones: [] }
                      },
                      activityLogs: []
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    } as unknown as LokiGuildWarResponse

    const wars = await convertRawWarPayload(payload, {
      ...baseCtx,
      previousWar: false
    })
    expect(wars).toHaveLength(1)
    const war = wars[0]!
    expect(war.warId).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff') // game uuid kept
    expect(war.status).toBe('active')
    expect(war.guildScore).toBe(4242) // snapshot currentScore override
    expect(war.opponentScore).toBe(999)
    expect(war.opponentGuildName).toBe('Enemy Guild')
    expect(war.battlefieldLevel).toBe(5)
    expect(war.season).toBe(2) // lastGuildWarEventId 7 => season 2
    const trench = war.zones?.find((z) => z.zoneType === 'Trenches1')
    expect(trench?.assignedPlayers).toContain('OurPlayer')
  })
})
