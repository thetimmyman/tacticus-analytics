import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import type { Database } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.unified-assignments')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import {
  requireSessionUser,
  resolveCurrentMembership
} from '@/app/lib/api/session-user'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import { computeRemainingBossSequence } from '@/app/lib/boss-assignments/season-sequence'
import { classifyPlayers } from '@/app/lib/boss-assignments/player-classifier'
import { orchestrateMultiStage } from '@/app/lib/boss-assignments/unified-orchestrator'
import {
  buildDamageModel,
  computeMeanDamagePerBattle,
  computeRosterEncounterDamagePerToken,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import {
  loadSkippedPrimesForSeason,
  type TargetTokenSkipRow
} from '@/app/lib/boss-assignments/resolve-skipped-primes'
import { resolveOfficerTargetsFromRows } from '@/app/lib/boss-assignments/resolve-officer-targets'
import { normalizeBossTargetId } from '@/app/lib/boss-assignments/target-ids'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { buildPlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'

import {
  getSeasonConfigById,
  getSeasonConfigIdForOffset,
  getSeasonPosition,
  SEASON_DURATION_SECONDS
} from '@/app/lib/loki/season-configs'
import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import {
  loadStageKillDurationMedians,
  projectStageStartSeconds
} from '@/app/lib/boss-assignments/stage-timing'
import {
  loadLiveGuildTokens,
  type LiveTokensSource
} from '@/app/lib/boss-assignments/live-tokens'
import {
  LEGACY_SEASON,
  isOfficerSkip,
  parseSeasonParam,
  selectSeasonScoped
} from '@/app/lib/boss-assignments/target-token-season'

export const dynamic = 'force-dynamic'

// Whole-raid token floor for recently synced players: MAX_TOKENS + one regen per 12h (~28-29),
// default 28 without Loki config. Read once at module load: a duration change needs a restart.
const PROJECTED_RAID_TOKEN_BUDGET = (() => {
  if (SEASON_DURATION_SECONDS > 0) {
    return (
      MAX_TOKENS + Math.floor(SEASON_DURATION_SECONDS / TWELVE_HOURS_IN_SECONDS)
    )
  }
  return 28
})()

const SYNC_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export const POST = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  const profile = await resolveCurrentMembership(supabase, user.id)

  if (!profile?.guild_code) {
    throw Errors.fromResponse(403, {
      error: 'Profile not found or access denied'
    })
  }

  // guildCode comes from the caller's profile, so there is no cross-guild read.

  const body = await request.json()
  const mode: 'current' | 'upcoming' = body.mode ?? 'current'
  const rawBodySeason = body.season_number ?? body.season
  const requestedSeason = parseSeasonParam(rawBodySeason)
  if (
    rawBodySeason !== undefined &&
    rawBodySeason !== null &&
    rawBodySeason !== '' &&
    requestedSeason === null
  ) {
    throw Errors.fromStatus(400, 'season_number must be a positive integer', {
      code: 'VALIDATION_ERROR'
    })
  }
  const playerTokenLimits: Record<string, number> | undefined =
    body.player_token_limits && typeof body.player_token_limits === 'object'
      ? body.player_token_limits
      : undefined
  const guildCode = profile.guild_code

  try {
    // Progression config is per-season and the loader rejects an uncaptured season.
    const seasonPos = getSeasonPosition()
    const targetSeason = requestedSeason ?? String(seasonPos.seasonNumber)
    const targetSeasonForConfig = Number.parseInt(targetSeason, 10)

    const [progressionConfig, rotationSnapshot, bossHpData] = await Promise.all(
      [
        getActiveProgressionConfig(guildCode, targetSeasonForConfig),
        ensureRotationSnapshot(),
        getAllBossHp()
      ]
    )

    const serviceClient = serviceDb()

    // skip=true is the only exclusion: encounter_id=0 drops the whole sequence entry. Not in generated types.
    /* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-syntax */
    const targetsTable = serviceClient.from(
      'boss_target_tokens' as never
    ) as any
    /* eslint-enable @typescript-eslint/no-explicit-any, no-restricted-syntax */
    const { data: skipRowsRaw, error: skipQueryError } = await targetsTable
      .select(
        'boss_name, rarity, set, encounter_id, source, seeded_from_seasons, skip, season_number, target_tokens'
      )
      .eq('guild_code', guildCode)
      .in('encounter_id', [0, 1, 2])
      .in('season_number', [targetSeason, LEGACY_SEASON])
    if (skipQueryError) {
      // Fail closed: without skip flags the solver would plan with no exclusions.
      logger.error(
        {
          guildCode,
          error:
            skipQueryError instanceof Error
              ? skipQueryError.message
              : String(skipQueryError)
        },
        'WI-654 skip query failed'
      )
      throw Errors.fromResponse(500, {
        error: `Failed to load boss skip flags: ${skipQueryError instanceof Error ? skipQueryError.message : 'unknown error'}`
      })
    }
    // Key by stage_code ("L4"), not boss_name, which repeats across stages. "None Available" seed
    // sentinels are not officer intent (isOfficerSkip matches the UI).
    const skipRows = (skipRowsRaw as TargetTokenSkipRow[] | null) ?? []
    const scopedSkipRows = selectSeasonScoped(
      skipRows.filter((row) => row.encounter_id === 0),
      targetSeason,
      (row) => `${row.boss_name ?? ''}__${row.rarity ?? ''}__${row.set ?? ''}`
    )
    const skippedStageCodes = new Set<string>()
    scopedSkipRows.forEach((r) => {
      if (!r.rarity || typeof r.set !== 'number' || r.set < 1 || r.set > 5)
        return
      if (!isOfficerSkip(r)) return
      const stageCode = deriveStageCodeFromSetAndRarity(r.set - 1, r.rarity)
      if (stageCode) skippedStageCodes.add(stageCode)
    })
    const officerTargets = resolveOfficerTargetsFromRows({
      season: targetSeason,
      targetTokenRows: skipRows
    })
    const targetSeasonNumber = Number.parseInt(targetSeason, 10)
    const seasonId = Number.isFinite(targetSeasonNumber)
      ? getSeasonConfigIdForOffset(targetSeasonNumber - seasonPos.seasonNumber)
          .id
      : null
    const targetSeasonConfig = seasonId ? getSeasonConfigById(seasonId) : null
    const targetSeasonBosses =
      targetSeasonConfig?.bosses ?? rotationSnapshot?.currentBosses ?? []
    const targetRotationSnapshot =
      rotationSnapshot &&
      targetSeasonConfig &&
      Number.isFinite(targetSeasonNumber)
        ? {
            ...rotationSnapshot,
            seasonNumber: targetSeasonNumber,
            currentConfigId: targetSeasonConfig.id,
            currentBosses: targetSeasonConfig.bosses
          }
        : rotationSnapshot
    const snapshotAt = new Date().toISOString()

    const snapshot = await buildPlanFromNowSnapshot({
      guildCode,
      supabase: serviceClient,
      season: targetSeason,
      seasonId,
      snapshotAt,
      rotationSnapshot: targetRotationSnapshot,
      bossHpData,
      progressionConfig
    })

    // Loaded before the sequence so real mean damage feeds difficulty estimates.
    const [membersResult, battleResult, skippedPrimes] = await Promise.all([
      guildRosterQuery(
        serviceClient,
        guildCode,
        'player_id, display_name, last_sync_tokens, last_sync_at'
      ),
      serviceClient
        .from('EOT_GR_data')
        .select(
          'userId, displayName, damageDealt, Name, encounterId, rarity, set, startedOn, damageType'
        )
        .eq('Guild', guildCode)
        .eq('Season', targetSeason)
        .in('damageType', ['Battle', 'Bomb'])
        .order('startedOn', { ascending: false })
        .limit(2000),
      loadSkippedPrimesForSeason(serviceClient, guildCode, targetSeason, {
        targetTokenRows: skipRows
      })
    ])

    if (membersResult.error) {
      throw Errors.fromResponse(500, {
        error: `Failed to load guild roster: ${membersResult.error.message}`
      })
    }
    if (battleResult.error) {
      throw Errors.fromResponse(500, {
        error: `Failed to load battle history: ${battleResult.error.message}`
      })
    }

    const members = membersResult.data
    const battleRows = battleResult.data

    type BattleRow = Pick<
      Database['public']['Tables']['EOT_GR_data']['Row'],
      | 'userId'
      | 'displayName'
      | 'damageDealt'
      | 'Name'
      | 'encounterId'
      | 'rarity'
      | 'set'
      | 'startedOn'
      | 'damageType'
    >
    const damageRecords: DamageRecord[] = (battleRows ?? [])
      .filter(
        (row): row is BattleRow & { userId: string; startedOn: string } =>
          typeof row.userId === 'string' && typeof row.startedOn === 'string'
      )
      .filter(
        (row) =>
          row.damageType === 'Battle' &&
          typeof row.damageDealt === 'number' &&
          row.damageDealt > 0
      )
      .map((row) => ({
        playerId: row.userId,
        bossName: row.Name ?? 'UnknownBoss',
        encounterId: row.encounterId ?? 0,
        rarity: row.rarity ?? null,
        set: row.set ?? null,
        startedOn: row.startedOn,
        damageDealt: row.damageDealt ?? 0
      }))

    const damageModel = buildDamageModel(damageRecords, {
      referenceAt: new Date().toISOString()
    })

    const guildAvgTokenDamage = computeMeanDamagePerBattle(damageRecords)

    const rosterPlayerIds = (members ?? [])
      .map((m) => m.player_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    const remainingSequence = computeRemainingBossSequence({
      progressionConfig,
      currentStageCode: snapshot.stageCode,
      currentLoopIndex: snapshot.loopIndex,
      seasonBosses: targetSeasonBosses,
      bossHpData,
      guildAvgDamage: guildAvgTokenDamage, // display-only fallback: estimatedTokensNeeded + difficulty
      currentStageHp: {
        mainRemainingHp: snapshot.encounters.main.remainingHp,
        prime1RemainingHp: snapshot.encounters.prime1.remainingHp,
        prime2RemainingHp: snapshot.encounters.prime2.remainingHp
      },
      skippedPrimes,
      encounterDamagePerToken: (target) =>
        computeRosterEncounterDamagePerToken(
          damageModel,
          rosterPlayerIds,
          target
        ),
      officerTargets
    })

    const filteredSequence = remainingSequence.filter(
      (entry) => !skippedStageCodes.has(entry.stageCode)
    )

    if (filteredSequence.length === 0) {
      logger.warn(
        {
          guildCode,
          stageCode: snapshot.stageCode,
          loopIndex: snapshot.loopIndex,
          remainingSequenceCount: remainingSequence.length,
          skippedStageCodes: Array.from(skippedStageCodes),
          seasonNumber: targetSeason
        },
        'unified-assignments: filtered sequence is empty'
      )
    }

    const playerInfos = (members ?? []).map((m) => ({
      playerId: m.player_id,
      displayName: m.display_name ?? m.player_id
    }))

    const classifiedPlayers = classifyPlayers({
      players: playerInfos,
      damageModel,
      bossSequence: filteredSequence
    })

    // Recently active members are floored at PROJECTED_RAID_TOKEN_BUDGET; dormant ones keep their
    // last-known count; body.player_token_limits overrides.
    const nowMs = Date.now()
    const playerTokens: Record<string, number> = {}
    for (const member of members ?? []) {
      const limit = playerTokenLimits?.[member.player_id]
      if (typeof limit === 'number' && Number.isFinite(limit)) {
        playerTokens[member.player_id] = Math.max(0, Math.trunc(limit))
        continue
      }
      const current = member.last_sync_tokens ?? 0
      const lastSyncMs = member.last_sync_at
        ? Date.parse(member.last_sync_at)
        : NaN
      const isRecentlyActive =
        Number.isFinite(lastSyncMs) &&
        nowMs - lastSyncMs <= SYNC_FRESHNESS_WINDOW_MS
      playerTokens[member.player_id] = isRecentlyActive
        ? Math.max(current, PROJECTED_RAID_TOKEN_BUDGET)
        : current
    }

    const overrides =
      body.config_overrides && typeof body.config_overrides === 'object'
        ? {
            minTokensPerBoss:
              typeof body.config_overrides.minTokensPerBoss === 'number'
                ? Math.max(
                    0,
                    Math.min(
                      20,
                      Math.trunc(body.config_overrides.minTokensPerBoss)
                    )
                  )
                : undefined,
            strongReservationFraction:
              typeof body.config_overrides.strongReservationFraction ===
              'number'
                ? Math.max(
                    0,
                    Math.min(1, body.config_overrides.strongReservationFraction)
                  )
                : undefined
          }
        : undefined

    // Cap each stage by the tokens a player can hold when it starts; on RPC error use the scalar model.
    let stageStartSecondsByIndex: number[] | undefined
    let stageMediansResolved = 0
    let stageMediansFallback = 0
    try {
      const medians = await loadStageKillDurationMedians(
        serviceClient,
        guildCode,
        targetSeasonNumber
      )
      const projections = projectStageStartSeconds(filteredSequence, medians)
      stageStartSecondsByIndex = projections.map((p) => p.startSeconds)
      for (const p of projections.slice(1)) {
        if (p.inboundDurationSource === 'fallback') stageMediansFallback += 1
        else if (p.inboundDurationSource) stageMediansResolved += 1
      }
    } catch (err) {
      logger.warn(
        {
          guildCode,
          season: targetSeason,
          error: err instanceof Error ? err.message : String(err)
        },
        'WI-737: stage kill-duration medians unavailable, falling back to scalar token cap'
      )
    }

    // live_api, then stored sync, then 0, capped at MAX_TOKENS.
    const liveTokens = await loadLiveGuildTokens({
      supabase: serviceClient,
      guildCode
    })
    if (liveTokens.source === 'live_api') {
      logger.info(
        {
          guildCode,
          entriesCount: liveTokens.entriesCount,
          apiCalledAt: liveTokens.apiCalledAt
        },
        'WI-737 AC3: live token refresh succeeded'
      )
    } else {
      logger.warn(
        { guildCode, source: liveTokens.source },
        'WI-737 AC3: live token refresh unavailable, falling back to stored sync'
      )
    }

    const currentTokensByPlayer: Record<string, number> = {}
    for (const member of members ?? []) {
      const live = liveTokens.tokens?.[member.player_id]
      const stored = member.last_sync_tokens ?? 0
      const seed = live != null ? live : stored
      currentTokensByPlayer[member.player_id] = Math.max(
        0,
        Math.min(MAX_TOKENS, seed)
      )
    }

    const result = orchestrateMultiStage({
      players: classifiedPlayers,
      playerTokens,
      bossSequence: filteredSequence,
      damageModel,
      options: overrides,
      currentTokensByPlayer,
      stageStartSecondsByIndex
    })

    const displayNameById = new Map<string, string>()
    for (const m of members ?? []) {
      displayNameById.set(m.player_id, m.display_name ?? m.player_id)
    }

    const allocationsByPlayer = new Map<string, Map<string, number>>()
    const assignments: Array<{
      display_name: string
      playerId: string
      bossId: string
      tokens: number
      score: number
      reasoning?: string
    }> = []

    for (const sa of result.stageAssignments) {
      for (const a of sa.assignments) {
        const displayName = displayNameById.get(a.playerId) ?? a.playerId
        const targetId = normalizeBossTargetId(a.bossId)
        let playerAllocations = allocationsByPlayer.get(displayName)
        if (!playerAllocations) {
          playerAllocations = new Map<string, number>()
          allocationsByPlayer.set(displayName, playerAllocations)
        }
        playerAllocations.set(
          targetId,
          (playerAllocations.get(targetId) ?? 0) + a.tokens
        )
        assignments.push({
          display_name: displayName,
          playerId: a.playerId,
          bossId: a.bossId,
          tokens: a.tokens,
          score: a.score,
          reasoning: a.reasoning
        })
      }
    }

    // Solver internals: `?debug=1` AND officer/leader/admin only.
    const url = new URL(request.url)
    const debugRequested = url.searchParams.get('debug') === '1'
    const canSeeDebug =
      profile.is_app_admin === true ||
      ['officer', 'leader', 'admin'].includes(
        String(profile.role ?? '').toLowerCase()
      )
    const debugEnabled = debugRequested && canSeeDebug
    let debug: Record<string, unknown> | undefined = undefined
    if (debugEnabled) {
      const activePlayerCount = classifiedPlayers.length
      const totalPlannedTokens = Object.values(result.playerBudgets).reduce(
        (s, b) => s + b.allocated,
        0
      )
      debug = {
        snapshot: {
          stageCode: snapshot.stageCode,
          loopIndex: snapshot.loopIndex,
          mainRemainingHp: snapshot.encounters.main.remainingHp,
          prime1RemainingHp: snapshot.encounters.prime1.remainingHp,
          prime2RemainingHp: snapshot.encounters.prime2.remainingHp
        },
        budgets: {
          projectedPerPlayer: PROJECTED_RAID_TOKEN_BUDGET,
          activePlayerCount,
          totalPlannedTokens
        },
        stages: result.stageAssignments.map((sa) => ({
          stageCode: sa.stageCode,
          loopIndex: sa.loopIndex,
          mainBossName: sa.projections.main.bossName,
          mainStartingHp: sa.projections.main.startingHp,
          mainProjectedRemainingHp: sa.projections.main.projectedRemainingHp,
          mainTokensPlanned: sa.projections.main.tokensPlanned,
          mainCoverage:
            sa.solverResult.coverage[`${sa.stageCode}_main`] ?? null,
          prime1Coverage:
            sa.solverResult.coverage[`${sa.stageCode}_prime1`] ?? null,
          prime2Coverage:
            sa.solverResult.coverage[`${sa.stageCode}_prime2`] ?? null
        }))
      }
    }

    // Any change between polls means the plan is stale; the UI can auto-replan.
    const newestBattleStartedOn = (battleRows ?? []).reduce<string | null>(
      (acc, row) => {
        const ts = (row as { startedOn?: string | null })?.startedOn ?? null
        if (!ts) return acc
        if (acc == null || ts > acc) return ts
        return acc
      },
      null
    )
    const newestMemberSync = (members ?? []).reduce<string | null>((acc, m) => {
      const ts = m.last_sync_at ?? null
      if (!ts) return acc
      if (acc == null || ts > acc) return ts
      return acc
    }, null)

    const planFreshness: {
      battleDataAsOf: string | null
      memberSyncMaxAt: string | null
      liveTokensSource: LiveTokensSource
      liveTokensCalledAt: string | null
      stageMediansResolved: number
      stageMediansFallback: number
    } = {
      battleDataAsOf: newestBattleStartedOn,
      memberSyncMaxAt: newestMemberSync,
      liveTokensSource: liveTokens.source,
      liveTokensCalledAt: liveTokens.apiCalledAt,
      stageMediansResolved,
      stageMediansFallback
    }

    // Names like "__proto__" must stay own JSON properties, never inherited lookups.
    const allocations = Object.fromEntries(
      Array.from(allocationsByPlayer, ([displayName, playerAllocations]) => [
        displayName,
        Object.fromEntries(playerAllocations)
      ])
    )

    return NextResponse.json({
      success: true,
      guild_code: guildCode,
      mode,
      current_stage: snapshot.stageCode,
      current_loop: snapshot.loopIndex,
      allocations,
      assignments,
      stage_assignments: result.stageAssignments.map((sa) => ({
        stageCode: sa.stageCode,
        loopIndex: sa.loopIndex,
        assignments: sa.assignments,
        coverage: sa.solverResult.coverage,
        projections: sa.projections,
        ...(sa.targetCaps ? { targetCaps: sa.targetCaps } : {})
      })),
      player_budgets: result.playerBudgets,
      sequence: result.sequence.map((s) => ({
        stageCode: s.stageCode,
        loopIndex: s.loopIndex,
        difficulty: s.difficulty,
        estimatedTokensNeeded: s.estimatedTokensNeeded,
        isCurrentStage: s.isCurrentStage,
        mainBoss: s.encounters.main.bossName,
        prime1Boss: s.encounters.prime1?.bossName ?? null,
        prime2Boss: s.encounters.prime2?.bossName ?? null
      })),
      warnings: result.warnings,
      metrics: result.metrics,
      planFreshness,
      ...(debug ? { debug } : {})
    })
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        guildCode,
        mode
      },
      'Unified assignment orchestration failed'
    )
    throw error
  }
})
