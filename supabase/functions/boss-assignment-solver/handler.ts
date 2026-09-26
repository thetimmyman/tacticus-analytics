import {
  badRequestResponse,
  corsOptionsResponse,
  errorResponse,
  successResponse
} from '../_shared/response-helpers.ts'
import { requireAuth } from '../_shared/auth-guard.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { logger } from '../_shared/logger.ts'
import { parseTeamComposition } from '../_shared/meta-analysis.ts'
import {
  solveAssignments,
  type SolverBoss,
  type SolverPlayer
} from './solver.ts'
import {
  type GlobalThreshold,
  type PlayerEntry,
  type PlaybookRequirement,
  type SolverMode,
  type SolverRequest,
  buildBossEntries,
  buildAssignmentScores,
  buildExcludedSet,
  buildPriorityMap,
  buildReliability,
  coerceSelectedBosses,
  isBossExcluded,
  makeBossLookupKey,
  mergeConfig,
  resolvePlayerTokenLimit
} from './solver-model.ts'
import {
  fetchBossConfig,
  fetchGuildClusterCode,
  fetchBossHp,
  fetchBossesFromSeasonData,
  fetchGlobalThresholds,
  fetchLatestSeason,
  fetchMetaTeams,
  fetchPerformanceSnapshot,
  fetchPlayerRosterStrength,
  fetchPlayers,
  fetchPlaybookRequirements,
  fetchRosterByUser,
  fetchRotationSnapshot
} from './solver-data.ts'
import { authorizeSolverGuildRequest } from './solver-auth.ts'

export const handler = async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  const authError = requireAuth(req)
  if (authError) return authError

  if (req.method !== 'POST') {
    return badRequestResponse('Use POST for boss assignment solver')
  }

  try {
    let payload: SolverRequest
    try {
      payload = await req.json()
    } catch {
      return badRequestResponse('Invalid JSON payload')
    }

    const guildCode = payload.guild_code?.trim()

    if (!guildCode) {
      return badRequestResponse('guild_code is required')
    }

    const authorizationError = await authorizeSolverGuildRequest(req, guildCode)
    if (authorizationError) return authorizationError

    const mode: SolverMode =
      payload.mode === 'current' || payload.mode === 'upcoming'
        ? payload.mode
        : 'current'

    const baseConfig = await fetchBossConfig(guildCode)
    const config = mergeConfig(baseConfig, payload.config_overrides ?? null)

    const excludedBosses = [
      ...config.excluded_bosses,
      ...(payload.excluded_bosses ?? [])
    ]
    const excludedSet = buildExcludedSet(excludedBosses)
    const priorityMap = buildPriorityMap(config.priority_groups)
    const priorityLevels = new Set(priorityMap.keys())

    let rawBosses = [] as Array<Record<string, unknown>>
    const selectedBosses = coerceSelectedBosses(payload.selected_bosses)

    if (selectedBosses.length > 0) {
      rawBosses = selectedBosses
    } else {
      const rotation = await fetchRotationSnapshot()
      if (rotation) {
        const useNext =
          mode === 'upcoming' ||
          (payload.season_id && payload.season_id === rotation.next_config_id)
        rawBosses = Array.isArray(
          useNext ? rotation.next_bosses : rotation.current_bosses
        )
          ? ((useNext
              ? rotation.next_bosses
              : rotation.current_bosses) as Array<Record<string, unknown>>)
          : []
      }
    }

    const season = payload.season ?? (await fetchLatestSeason(guildCode))

    if (rawBosses.length === 0 && season) {
      rawBosses = await fetchBossesFromSeasonData(guildCode, season)
    }

    if (rawBosses.length === 0) {
      return errorResponse('Unable to resolve boss list for solver', 404)
    }

    let bosses = buildBossEntries(rawBosses)
    if (priorityLevels.size > 0) {
      bosses = bosses.filter((boss) => priorityLevels.has(boss.level))
    }
    bosses = bosses.filter((boss) => !isBossExcluded(boss, excludedSet))

    if (bosses.length === 0) {
      return badRequestResponse('All bosses were excluded from assignment')
    }

    const bossHpMap = await fetchBossHp(guildCode)
    const performance = season
      ? await fetchPerformanceSnapshot(guildCode, season, bosses)
      : {
          playerAvg: new Map(),
          bossAvg: new Map(),
          battlesByPlayer: new Map()
        }

    const minAttacks = Number.isFinite(payload.min_attacks)
      ? Math.max(1, Math.trunc(payload.min_attacks ?? 20))
      : 20
    const metaTeams = await fetchMetaTeams(bosses, season, minAttacks)
    const bossTeamHeroes = new Map<string, string[]>()
    metaTeams.forEach((team, bossKey) => {
      const parsed = parseTeamComposition(team.composition)
      const heroes = parsed.mow ? [...parsed.heroes, parsed.mow] : parsed.heroes
      bossTeamHeroes.set(bossKey, heroes)
    })
    bosses = bosses.map((boss) => {
      const bossKey = makeBossLookupKey(
        boss.name,
        boss.rarity,
        boss.set,
        boss.encounterId
      )
      const hp = bossHpMap.get(bossKey) ?? 0
      const avgDamage =
        performance.bossAvg.get(bossKey) ??
        metaTeams.get(bossKey)?.damageP90 ??
        0
      const requiredTokens =
        hp > 0 && avgDamage > 0 ? Math.max(1, Math.ceil(hp / avgDamage)) : 0

      const targetTokens = Math.max(requiredTokens, config.min_tokens_per_boss)

      return {
        ...boss,
        hp,
        requiredTokens: targetTokens
      }
    })

    const players = await fetchPlayers(guildCode)

    if (players.length === 0) {
      return errorResponse('No active guild members found for assignment', 404)
    }

    const userIds = Array.from(
      new Set(players.map((player) => player.userId).filter(Boolean))
    ) as string[]
    const rosterByUser = await fetchRosterByUser(userIds)

    const playersWithRoster: PlayerEntry[] = players.map((player) => {
      const roster = player.userId
        ? (rosterByUser.get(player.userId) ?? [])
        : []
      const battleCount = performance.battlesByPlayer.get(player.name) ?? 0
      const maxTokens = resolvePlayerTokenLimit(
        payload.player_token_limits,
        player.id,
        config.max_tokens_per_player
      )
      return {
        ...player,
        maxTokens,
        roster,
        reliability: buildReliability(battleCount)
      }
    })

    const primeCounts = new Map<string, number>()
    bosses.forEach((boss) => {
      if (boss.isPrime) {
        primeCounts.set(boss.level, (primeCounts.get(boss.level) ?? 0) + 1)
      }
    })

    const clusterCode = await fetchGuildClusterCode(guildCode)

    const rosterStrengthMap = await fetchPlayerRosterStrength(userIds)

    // Pre-fetch playbook requirements (avoids N+1).
    const playbookCache = new Map<string, PlaybookRequirement | null>()
    const globalThresholdCache = new Map<string, GlobalThreshold[]>()

    for (const boss of bosses) {
      const bossId = `${boss.name}_${boss.rarity}_${boss.set}_${boss.encounterId}`
      if (!playbookCache.has(bossId)) {
        const playbook = await fetchPlaybookRequirements(
          bossId,
          guildCode,
          clusterCode
        )
        playbookCache.set(bossId, playbook)
      }
      if (!globalThresholdCache.has(boss.rarity)) {
        const thresholds = await fetchGlobalThresholds(boss.rarity)
        globalThresholdCache.set(boss.rarity, thresholds)
      }
    }

    const scores = buildAssignmentScores({
      players: playersWithRoster,
      bosses,
      performance,
      metaTeams,
      bossTeamHeroes,
      rosterStrengthMap,
      playbookCache,
      globalThresholdCache,
      config,
      priorityMap,
      primeCounts
    })

    const solverBosses: SolverBoss[] = bosses.map((boss) => ({
      id: boss.id,
      name: boss.name,
      level: boss.level,
      isPrime: boss.isPrime,
      requiredTokens: boss.requiredTokens,
      minTokens: boss.requiredTokens > 0 ? config.min_tokens_per_boss : 0,
      maxTokens: config.max_tokens_per_boss,
      priorityRank:
        priorityMap.get(boss.level) ?? config.priority_groups.length,
      maxTokensPerPlayer: config.max_tokens_per_player
    }))

    const solverPlayers: SolverPlayer[] = playersWithRoster.map((player) => ({
      id: player.id,
      name: player.name,
      maxTokens: player.maxTokens
    }))

    const result = solveAssignments({
      players: solverPlayers,
      bosses: solverBosses,
      scores
    })

    const bossById = new Map(bosses.map((boss) => [boss.id, boss]))
    const playerNameById = new Map(
      playersWithRoster.map((player) => [player.id, player.name])
    )

    result.assignments.forEach((assignment) => {
      const boss = bossById.get(assignment.bossId)
      const playerName =
        playerNameById.get(assignment.playerId) ?? assignment.playerId
      if (!boss) return

      const bossKey = makeBossLookupKey(
        boss.name,
        boss.rarity,
        boss.set,
        boss.encounterId
      )
      const playerAvg = performance.playerAvg.get(playerName)?.get(bossKey)
      const coverage = result.coverage[assignment.bossId]

      const parts: string[] = []
      if (playerAvg !== undefined) {
        const dmgLabel =
          playerAvg >= 1_000_000
            ? `${(playerAvg / 1_000_000).toFixed(1)}M`
            : `${Math.round(playerAvg / 1000)}K`
        parts.push(`avg ${dmgLabel} dmg`)
      } else {
        parts.push('no history (roster-based)')
      }

      if (coverage) {
        const pct = Math.round(coverage.percentage)
        if (pct >= 100) parts.push('boss fully covered')
        else parts.push(`${pct}% covered`)
      }

      assignment.reasoning = parts.join(', ')
    })

    const allocations: Record<string, Record<string, number>> = {}

    result.assignments.forEach((assignment) => {
      const displayName = playerNameById.get(assignment.playerId)
      if (!displayName) return
      if (!allocations[displayName]) allocations[displayName] = {}
      allocations[displayName][assignment.bossId] = assignment.tokens
    })

    const assignments = result.assignments.map((assignment) => {
      const boss = bossById.get(assignment.bossId)
      return {
        ...assignment,
        display_name:
          playerNameById.get(assignment.playerId) ?? assignment.playerId,
        boss_name: boss?.name ?? assignment.bossId,
        boss_level: boss?.level ?? assignment.bossId,
        is_prime: boss?.isPrime ?? false
      }
    })

    const warnings: string[] = []
    const totalRequired = bosses.reduce(
      (sum, boss) => sum + boss.requiredTokens,
      0
    )
    const totalAvailable = solverPlayers.reduce(
      (sum, player) => sum + player.maxTokens,
      0
    )

    if (totalAvailable < totalRequired) {
      warnings.push(
        'Not enough tokens to cover all boss requirements; some bosses will be under-covered.'
      )
    }

    return successResponse({
      success: true,
      guild_code: guildCode,
      mode,
      season,
      assignments,
      allocations,
      coverage: result.coverage,
      warnings,
      meta: {
        total_players: playersWithRoster.length,
        total_bosses: bosses.length,
        total_tokens_available: totalAvailable,
        total_tokens_assigned: result.totalTokensAssigned,
        objective_score: result.totalScore,
        strategy: 'bottom-up-progression'
      }
    })
  } catch (error) {
    logger.error('boss-assignment-solver failed', error)
    return errorResponse('Internal server error', 500)
  }
}
