import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import {
  findUpgradePaths,
  createTeamDAG,
  type TeamData
} from '@/app/lib/meta/team-progression'
import {
  parseTeamComposition,
  calculateCoverage
} from '@/app/lib/meta/team-coverage'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.optimize')
import bossesConfig from '@/config/bosses.json'
import { getBossDisplayName as resolveCuratedBossName } from '@/app/lib/utils/bossNames'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

const OPTIMIZER_LIMITS = {
  maxBytes: 64 * 1024,
  maxRosterHeroes: 300,
  maxBosses: 50,
  maxStringLength: 128,
  maxPlayerNameLength: 100,
  maxMetaRows: 5000,
  maxTeamsPerBoss: 250
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > OPTIMIZER_LIMITS.maxBytes
    ) {
      throw Errors.fromResponse(413, {
        error: 'Optimizer payload is too large'
      })
    }
  }

  if (!request.body) {
    throw Errors.fromResponse(400, { error: 'JSON body is required' })
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > OPTIMIZER_LIMITS.maxBytes) {
        await reader.cancel('Optimizer payload exceeds the byte limit')
        throw Errors.fromResponse(413, {
          error: 'Optimizer payload is too large'
        })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const rawBody = Buffer.concat(
    chunks.map((chunk) =>
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    ),
    totalBytes
  ).toString('utf8')
  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    throw Errors.fromResponse(400, { error: 'Invalid JSON payload' })
  }
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > OPTIMIZER_LIMITS.maxBosses) {
    throw Errors.validation(
      `${field} must be an array with at most ${OPTIMIZER_LIMITS.maxBosses} entries`
    )
  }
  const parsed = value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.length > OPTIMIZER_LIMITS.maxStringLength
    ) {
      throw Errors.validation(`${field} contains an invalid value`)
    }
    return entry
  })
  return [...new Set(parsed)]
}

const configUnitIdToDisplayName = new Map<string, string>()
for (const boss of bossesConfig.bosses) {
  configUnitIdToDisplayName.set(
    boss.engineNameOrId.toLowerCase(),
    boss.displayName
  )
}

function getBossDisplayName(unitId: string, fallback: string): string {
  const displayName = configUnitIdToDisplayName.get(unitId.toLowerCase())
  if (displayName) {
    return displayName
  }
  // 'BelisariusRW' -> 'Belisarius Cawl', not 'Belisarius RW'.
  return resolveCuratedBossName(fallback)
}

interface UpgradeStep {
  swapped_out: string
  swapped_in: string
  damage_increase: number
  percent_increase: number
  new_damage_p90: number
  meta_team: string | null
  to_team: string
}

interface OptimizedAssignment {
  boss_type: string
  boss_unit_id?: string | null
  rarity_set: string
  recommended_team: {
    composition: string
    heroes: string[]
    mow: string | null
    meta_team: string | null
  }
  expected_damage_p90: number
  expected_damage_avg: number
  attack_count: number
  coverage_score: number
  missing_heroes: string[]
  next_upgrade?: UpgradeStep | null
}

interface OptimizationResult {
  player_name: string
  roster_size: number
  assignments: OptimizedAssignment[]
  unassigned_bosses: string[]
  optimization_notes: string[]
}

function extractBossTypeFromUnitId(unitId: string): string | null {
  const match = unitId.match(
    /^GuildBoss\d+(?:MiniBoss\d+|Boss\d+)?([A-Z][a-zA-Z]+)/
  )
  if (match && match[1]) {
    return match[1]
  }
  return null
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: false,
    skipSecurityChecks: true
  })
  if (securityResult) return securityResult

  try {
    // Deliberately unauthenticated: stateless over the caller's roster and public reference data.
    const rawBody = await readBoundedJson(request)
    if (!isRecord(rawBody)) {
      throw Errors.validation('Request body must be a JSON object')
    }
    const body = rawBody
    const {
      player_name,
      roster,
      rarity_set = 'all',
      boss_unit_ids,
      boss_types,
      boss_type_map,
      min_coverage = 60,
      allow_hero_reuse = true
    } = body

    if (!Array.isArray(roster) || roster.length === 0) {
      throw Errors.fromResponse(400, {
        error: 'roster is required and must be a non-empty array'
      })
    }
    if (roster.length > OPTIMIZER_LIMITS.maxRosterHeroes) {
      throw Errors.validation(
        `roster must contain at most ${OPTIMIZER_LIMITS.maxRosterHeroes} heroes`
      )
    }

    const rosterNames = roster.map((hero) => {
      const name =
        typeof hero === 'string' ? hero : isRecord(hero) ? hero.name : null
      if (
        typeof name !== 'string' ||
        name.length === 0 ||
        name.length > OPTIMIZER_LIMITS.maxStringLength
      ) {
        throw Errors.validation('roster contains an invalid hero name')
      }
      return name
    })

    if (
      player_name !== undefined &&
      (typeof player_name !== 'string' ||
        player_name.length > OPTIMIZER_LIMITS.maxPlayerNameLength)
    ) {
      throw Errors.validation('player_name is invalid')
    }
    if (
      typeof rarity_set !== 'string' ||
      rarity_set.length > OPTIMIZER_LIMITS.maxStringLength
    ) {
      throw Errors.validation('rarity_set is invalid')
    }
    if (
      typeof min_coverage !== 'number' ||
      !Number.isFinite(min_coverage) ||
      min_coverage < 0 ||
      min_coverage > 100
    ) {
      throw Errors.validation('min_coverage must be between 0 and 100')
    }
    if (typeof allow_hero_reuse !== 'boolean') {
      throw Errors.validation('allow_hero_reuse must be a boolean')
    }

    const rosterSet = new Set<string>(rosterNames)

    const requestedBossUnitIds = parseStringArray(
      boss_unit_ids,
      'boss_unit_ids'
    )
    const requestedBossTypes = parseStringArray(boss_types, 'boss_types')
    if (boss_type_map !== undefined && !isRecord(boss_type_map)) {
      throw Errors.validation('boss_type_map must be an object')
    }
    const providedBossTypeMap: Record<string, string> = {}
    for (const [unitId, bossType] of Object.entries(boss_type_map || {})) {
      if (
        Object.keys(providedBossTypeMap).length >= OPTIMIZER_LIMITS.maxBosses ||
        unitId.length === 0 ||
        unitId.length > OPTIMIZER_LIMITS.maxStringLength ||
        typeof bossType !== 'string' ||
        bossType.length === 0 ||
        bossType.length > OPTIMIZER_LIMITS.maxStringLength
      ) {
        throw Errors.validation('boss_type_map contains an invalid entry')
      }
      providedBossTypeMap[unitId] = bossType
    }

    const hasBossUnitIds = requestedBossUnitIds.length > 0
    const hasBossTypes = requestedBossTypes.length > 0
    const supabase = serviceDb()

    const unitIdToBossType: Record<string, string> = {}
    const bossDisplayNames: Record<string, string> = {}

    if (hasBossUnitIds) {
      for (const unitId of requestedBossUnitIds) {
        bossDisplayNames[unitId] = getBossDisplayName(
          unitId,
          providedBossTypeMap[unitId] || unitId
        )
        if (providedBossTypeMap[unitId]) {
          unitIdToBossType[unitId] = providedBossTypeMap[unitId]
        }
      }

      const unmappedUnitIds = requestedBossUnitIds.filter(
        (id) => !unitIdToBossType[id]
      )
      if (unmappedUnitIds.length > 0) {
        const { data: bossMappings } = await supabase
          .from('boss_mapping')
          .select('unit_id, boss_type, boss_name')
          .in('unit_id', unmappedUnitIds)

        for (const mapping of bossMappings || []) {
          if (mapping.unit_id && mapping.boss_type) {
            unitIdToBossType[mapping.unit_id] = mapping.boss_type
          }
        }
      }

      // Last resort; may not match meta_atlas_data boss_type.
      for (const unitId of requestedBossUnitIds) {
        if (!unitIdToBossType[unitId]) {
          const extracted = extractBossTypeFromUnitId(unitId)
          if (extracted) {
            unitIdToBossType[unitId] = extracted
          }
        }
      }
    }
    const fallbackBossTypes = [...new Set(Object.values(unitIdToBossType))]

    let query = supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, team_composition, meta_team, boss_type, boss_unit_id, rarity_set, damage_p90, damage_avg, attack_count'
      )
      .not('rarity_set', 'is', null)
      .gte('attack_count', 20)
      .order('damage_p90', { ascending: false })
      .limit(OPTIMIZER_LIMITS.maxMetaRows)

    if (hasBossUnitIds) {
      if (fallbackBossTypes.length > 0) {
        query = query.in('boss_type', fallbackBossTypes)
      } else {
        query = query.in('boss_unit_id', requestedBossUnitIds)
      }
    } else if (hasBossTypes) {
      query = query.in('boss_type', requestedBossTypes)
    }

    if (rarity_set && rarity_set !== 'all') {
      query = query.eq('rarity_set', rarity_set)
    }

    const { data: metaData, error: metaError } = await query

    if (metaError) throw metaError

    const bossTeams: Record<string, typeof metaData> = {}
    const bossKeyToDisplayName: Record<string, string> = {}

    for (const row of metaData || []) {
      if (hasBossUnitIds) {
        for (const unitId of requestedBossUnitIds) {
          const expectedBossType = unitIdToBossType[unitId]
          if (
            row.boss_unit_id === unitId ||
            (expectedBossType && row.boss_type === expectedBossType)
          ) {
            if (!bossTeams[unitId]) {
              bossTeams[unitId] = []
              bossKeyToDisplayName[unitId] =
                bossDisplayNames[unitId] ||
                getBossDisplayName(unitId, row.boss_type)
            }
            if (bossTeams[unitId].length < OPTIMIZER_LIMITS.maxTeamsPerBoss) {
              bossTeams[unitId].push(row)
            }
          }
        }
      } else {
        const bossKey = row.boss_type
        if (!bossTeams[bossKey]) {
          bossTeams[bossKey] = []
          bossKeyToDisplayName[bossKey] = getBossDisplayName(
            row.boss_unit_id || '',
            row.boss_type
          )
        }
        if (bossTeams[bossKey].length < OPTIMIZER_LIMITS.maxTeamsPerBoss) {
          bossTeams[bossKey].push(row)
        }
      }
    }

    const requestedBosses = hasBossUnitIds
      ? requestedBossUnitIds
      : hasBossTypes
        ? requestedBossTypes
        : Object.keys(bossTeams)

    const assignments: OptimizedAssignment[] = []
    const usedHeroes = new Set<string>()
    const unassignedBosses: string[] = []

    for (const bossKey of requestedBosses) {
      const teamsForBoss = bossTeams[bossKey] || []
      let bestTeam: OptimizedAssignment | null = null
      let bestScore = -1

      for (const team of teamsForBoss) {
        if (!team.team_composition || !team.damage_p90) continue

        const { heroes, mow } = parseTeamComposition(team.team_composition)
        const allUnits = mow ? [...heroes, mow] : heroes

        const hasConflict =
          !allow_hero_reuse &&
          allUnits.some((h) => usedHeroes.has(h.toLowerCase()))
        if (hasConflict) continue

        const { score, missing } = calculateCoverage(allUnits, rosterSet)

        if (score < min_coverage) continue

        const weightedScore = score * 0.3 + (team.damage_p90 / 1000000) * 0.7

        if (weightedScore > bestScore) {
          bestScore = weightedScore
          bestTeam = {
            boss_type: bossKeyToDisplayName[bossKey] || team.boss_type,
            boss_unit_id: team.boss_unit_id,
            rarity_set: team.rarity_set || '',
            recommended_team: {
              composition: team.team_composition,
              heroes,
              mow,
              meta_team: team.meta_team
            },
            expected_damage_p90: Math.round(team.damage_p90),
            expected_damage_avg: Math.round(team.damage_avg || 0),
            attack_count: team.attack_count || 0,
            coverage_score: Math.round(score),
            missing_heroes: missing
          }
        }
      }

      if (bestTeam) {
        const { heroes, mow } = bestTeam.recommended_team
        const allUnits = mow ? [...heroes, mow] : heroes
        allUnits.forEach((h) => usedHeroes.add(h.toLowerCase()))
        assignments.push(bestTeam)
      } else {
        const displayName = bossKeyToDisplayName[bossKey] || bossKey
        if (!unassignedBosses.includes(displayName)) {
          unassignedBosses.push(displayName)
        }
      }
    }

    assignments.sort((a, b) => b.expected_damage_p90 - a.expected_damage_p90)

    for (const assignment of assignments) {
      try {
        const bossKey = assignment.boss_unit_id || assignment.boss_type
        const bossTeamsForDAG =
          bossTeams[bossKey] || bossTeams[assignment.boss_type] || []
        const teamData: TeamData[] = bossTeamsForDAG
          .filter(
            (
              t
            ): t is typeof t & {
              team_composition: string
              damage_p90: number
            } => t.team_composition !== null && t.damage_p90 !== null
          )
          .map((t) => ({
            team_composition: t.team_composition,
            damage_p90: t.damage_p90,
            attack_count: t.attack_count || 0,
            meta_team: t.meta_team
          }))

        if (teamData.length > 1) {
          const dag = createTeamDAG(teamData, { minCommonMembers: 5 })
          const upgrades = findUpgradePaths(
            dag,
            assignment.recommended_team.composition
          )

          const feasibleUpgrade = upgrades.find((u) => {
            const newHero = u.swappedIn.toLowerCase()
            return (
              rosterSet.has(newHero) ||
              [...rosterSet].some(
                (r) =>
                  r.toLowerCase().includes(newHero) ||
                  newHero.includes(r.toLowerCase())
              )
            )
          })

          if (feasibleUpgrade) {
            assignment.next_upgrade = {
              swapped_out: feasibleUpgrade.swappedOut,
              swapped_in: feasibleUpgrade.swappedIn,
              damage_increase: Math.round(feasibleUpgrade.damageIncrease),
              percent_increase:
                Math.round(feasibleUpgrade.percentIncrease * 10) / 10,
              new_damage_p90: Math.round(feasibleUpgrade.to.damageP90),
              meta_team: feasibleUpgrade.to.metaTeam,
              to_team: feasibleUpgrade.to.composition
            }
          }
        }
      } catch (e) {
        logger.warn(
          { bossType: assignment.boss_type, error: e },
          'Error finding upgrades'
        )
      }
    }

    const notes: string[] = []
    if (unassignedBosses.length > 0) {
      const rarityNote =
        rarity_set && rarity_set !== 'all' ? ` at ${rarity_set} rarity` : ''
      notes.push(
        `No meta data found for ${unassignedBosses.length} boss(es)${rarityNote}. Try selecting "All Rarity Sets".`
      )
    }
    if (assignments.some((a) => a.missing_heroes.length > 0)) {
      notes.push(
        'Some recommended teams have heroes you may not own - check the missing heroes list'
      )
    }
    const totalExpectedDamage = assignments.reduce(
      (sum, a) => sum + a.expected_damage_p90,
      0
    )
    notes.push(
      `Total expected P90 damage across all assignments: ${(totalExpectedDamage / 1000000).toFixed(2)}M`
    )

    const result: OptimizationResult = {
      player_name: player_name || 'Unknown',
      roster_size: rosterSet.size,
      assignments,
      unassigned_bosses: unassignedBosses,
      optimization_notes: notes
    }

    return NextResponse.json(result)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Team optimizer error')
    throw Errors.fromResponse(500, {
      error: 'Failed to optimize team assignments'
    })
  }
})
