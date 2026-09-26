import { useMemo } from 'react'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import { buildStageAssignmentTokenMap } from '@/app/lib/boss-assignments/target-ids'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'
import { getPrimeHpForLevel } from '../utils/boss-calculations'
import { lookupAvgDamageForPlayer } from '../components/queue-helpers'
import type { CurrentBossAssignmentRow } from '../components/CurrentBossAssignmentsPanel'
import type { AssignmentState } from './useAssignmentState'
import type { useCurrentBossStatus } from './useCurrentBossStatus'
import type { useCurrentBossAttacks } from './useCurrentBossAttacks'
import type {
  BossHpData,
  HeraldCascadeConfigEntry,
  LokiBoss,
  SolverResponse
} from '../types'

export function useCurrentBossRows({
  mode,
  currentStageCode,
  currentLoopIndex,
  currentBossName,
  currentBossHp,
  lokiCurrentBosses,
  currentBossStatusQuery,
  currentBossAttacksQuery,
  tokenStatusByPlayerId,
  state,
  queueViewData,
  initialBossHpData,
  initialHeraldBossConfigs
}: {
  mode: 'current'
  currentStageCode: string | null
  currentLoopIndex: number | null
  currentBossName: string | null
  currentBossHp: { remainingHp: number | null; maxHp: number | null }
  lokiCurrentBosses: LokiBoss[] | undefined
  currentBossStatusQuery: ReturnType<typeof useCurrentBossStatus>
  currentBossAttacksQuery: ReturnType<typeof useCurrentBossAttacks>
  tokenStatusByPlayerId: Map<
    string,
    {
      tokensAvailable: number
      tokenCooldown: string | null
      nextTokenSeconds: number | null
    }
  >
  state: AssignmentState
  queueViewData: SolverResponse | null
  initialBossHpData: BossHpData
  initialHeraldBossConfigs: HeraldCascadeConfigEntry[]
}): CurrentBossAssignmentRow[] {
  const currentBossAttackStatsByPlayerId = useMemo(() => {
    const map = new Map<
      string,
      Record<number, { usedTokens: number; damage: number }>
    >()
    ;(currentBossAttacksQuery.data ?? []).forEach((attack) => {
      if (typeof attack.userId !== 'string' || attack.userId.length === 0)
        return

      const encounterId =
        typeof attack.encounterId === 'number' &&
        Number.isFinite(attack.encounterId)
          ? Math.max(0, Math.trunc(attack.encounterId))
          : 0

      const damage =
        typeof attack.damageDealt === 'number' &&
        Number.isFinite(attack.damageDealt)
          ? attack.damageDealt
          : 0

      const existing = map.get(attack.userId) ?? {}
      const existingStats = existing[encounterId] ?? {
        usedTokens: 0,
        damage: 0
      }

      map.set(attack.userId, {
        ...existing,
        [encounterId]: {
          usedTokens: existingStats.usedTokens + 1,
          damage: existingStats.damage + damage
        }
      })
    })
    return map
  }, [currentBossAttacksQuery.data])

  const currentBossTargets = useMemo(() => {
    if (mode !== 'current' || !currentStageCode) {
      return [] as Array<{
        targetId: string
        label: string
        bossName: string | null
        encounterId: 0 | 1 | 2
      }>
    }

    const bosses = lokiCurrentBosses ?? []
    const stageBosses = bosses.filter(
      (boss) =>
        deriveStageCodeFromSetAndRarity(boss.set, boss.rarity) ===
        currentStageCode
    )

    const lokiMainStageBoss =
      stageBosses.find((boss) => boss.encounter_id === 0) ?? null
    const lokiPrime1 =
      stageBosses.find((boss) => boss.encounter_id === 1) ?? null
    const lokiPrime2 =
      stageBosses.find((boss) => boss.encounter_id === 2) ?? null

    // Name from Loki rotation data, never `state.selectedBosses`, which nothing edits.
    const mainName = lokiMainStageBoss?.boss_name ?? currentBossName
    const prime1Name = lokiPrime1?.boss_name ?? null
    const prime2Name = lokiPrime2?.boss_name ?? null

    return [
      {
        targetId: currentStageCode,
        label: 'Main',
        bossName: mainName,
        encounterId: 0
      },
      {
        targetId: `${currentStageCode}_Sub1`,
        label: 'Prime 1',
        bossName: prime1Name,
        encounterId: 1
      },
      {
        targetId: `${currentStageCode}_Sub2`,
        label: 'Prime 2',
        bossName: prime2Name,
        encounterId: 2
      }
    ]
  }, [currentBossName, currentStageCode, lokiCurrentBosses, mode])

  const currentBossRows: CurrentBossAssignmentRow[] = useMemo(() => {
    if (mode !== 'current' || !currentStageCode) return []

    const DEFAULT_AVG_DAMAGE = 750000
    const formatSeconds = (totalSeconds: number) => {
      const seconds = Math.max(0, Math.trunc(totalSeconds))
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      if (hours <= 0) return `${minutes}m`
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    }
    const targetOrder = new Map(
      currentBossTargets.map((target, idx) => [target.targetId, idx])
    )

    const currentStageQueuePlanByPlayerTarget = buildStageAssignmentTokenMap(
      queueViewData?.stage_assignments,
      currentStageCode,
      currentLoopIndex
    )

    const rows = state.players
      .flatMap((player) => {
        const allocationKey = player.display_name
        const allocations =
          state.playerTokenAllocations[allocationKey] ||
          state.playerTokenAllocations[player.player_id] ||
          {}

        return currentBossTargets
          .map<CurrentBossAssignmentRow | null>((target) => {
            const allocationValue = allocations[target.targetId]
            const plannedFromState =
              typeof allocationValue === 'number' ? allocationValue : 0
            const plannedFromQueue =
              currentStageQueuePlanByPlayerTarget.get(
                `${player.player_id}:${target.targetId}`
              ) ?? 0
            const planned = Math.max(plannedFromState, plannedFromQueue)
            const attackStats = currentBossAttackStatsByPlayerId.get(
              player.player_id
            )?.[target.encounterId]
            const used = attackStats?.usedTokens ?? 0
            const actualDamage = attackStats?.damage ?? 0
            if (planned <= 0 && used <= 0) return null

            const remaining = Math.max(0, planned - used)
            const avgDamage = lookupAvgDamageForPlayer(
              state.performanceData,
              player,
              target.bossName,
              currentStageCode
            )
            const targetLabel = target.bossName ?? target.label
            const tokenStatus =
              tokenStatusByPlayerId.get(player.player_id) ?? null
            const tokensAvailable = tokenStatus?.tokensAvailable ?? null

            // "Ready" = at the 3-token cap (regen wasted), else a countdown; matches GRAvailability.
            const timeToNextToken =
              tokenStatus && tokenStatus.tokensAvailable >= 3
                ? 'Ready'
                : tokenStatus?.tokenCooldown ||
                  (typeof tokenStatus?.nextTokenSeconds === 'number'
                    ? formatSeconds(tokenStatus.nextTokenSeconds)
                    : null)

            return {
              playerId: player.player_id,
              displayName: player.display_name,
              tokensAvailable,
              timeToNextToken,
              target: targetLabel,
              targetId: target.targetId,
              targetRemainingHp: null as number | null,
              planned,
              used,
              remaining,
              avgDamage,
              actualDamage,
              estHpRemaining: null as number | null,
              unplanned: used > planned
            } satisfies CurrentBossAssignmentRow
          })
          .filter((row): row is CurrentBossAssignmentRow => Boolean(row))
      })
      .filter((row) => row.planned > 0 || row.used > 0)

    rows.sort((a, b) => {
      const orderA = targetOrder.get(a.targetId) ?? 99
      const orderB = targetOrder.get(b.targetId) ?? 99
      if (orderA !== orderB) return orderA - orderB

      const aTotal = a.planned + a.used
      const bTotal = b.planned + b.used
      if (bTotal !== aTotal) return bTotal - aTotal

      if (b.remaining !== a.remaining) return b.remaining - a.remaining

      if (b.used !== a.used) return b.used - a.used

      return a.playerId.localeCompare(b.playerId)
    })

    const summedActualDamageByTargetId = new Map<string, number>()
    rows.forEach((row) => {
      summedActualDamageByTargetId.set(
        row.targetId,
        (summedActualDamageByTargetId.get(row.targetId) ?? 0) + row.actualDamage
      )
    })

    const baselineRemainingByTargetId = new Map<string, number>()

    const mainBaseline =
      typeof currentBossHp.remainingHp === 'number' &&
      Number.isFinite(currentBossHp.remainingHp)
        ? currentBossHp.remainingHp
        : typeof currentBossHp.maxHp === 'number' &&
            Number.isFinite(currentBossHp.maxHp)
          ? currentBossHp.maxHp
          : null

    if (typeof mainBaseline === 'number') {
      baselineRemainingByTargetId.set(
        currentStageCode,
        Math.max(0, mainBaseline)
      )
    }

    const encounterRemainingHpByEncounterId = new Map<number, number | null>()
    ;(currentBossStatusQuery.data?.encounters ?? []).forEach((encounter) => {
      encounterRemainingHpByEncounterId.set(
        encounter.encounterId,
        encounter.remainingHp
      )
    })

    currentBossTargets.forEach((target) => {
      if (target.encounterId === 0) return
      if (!target.bossName) return
      if (!currentBossName) return

      const statusRemaining = encounterRemainingHpByEncounterId.get(
        target.encounterId
      )
      if (
        typeof statusRemaining === 'number' &&
        Number.isFinite(statusRemaining)
      ) {
        baselineRemainingByTargetId.set(
          target.targetId,
          Math.max(0, statusRemaining)
        )
        return
      }

      const slot = target.encounterId === 2 ? 2 : 1
      const maxHp = getPrimeHpForLevel(
        currentBossName,
        target.bossName,
        currentStageCode,
        slot,
        state.primeHpData,
        initialBossHpData
      )

      if (!(typeof maxHp === 'number' && Number.isFinite(maxHp) && maxHp > 0)) {
        return
      }

      const actualDamage =
        summedActualDamageByTargetId.get(target.targetId) ?? 0
      baselineRemainingByTargetId.set(
        target.targetId,
        Math.max(0, maxHp - actualDamage)
      )
    })

    const runningRemainingByTargetId = new Map<string, number>(
      baselineRemainingByTargetId
    )

    rows.forEach((row) => {
      const baseline = baselineRemainingByTargetId.get(row.targetId)
      row.targetRemainingHp =
        typeof baseline === 'number' && Number.isFinite(baseline)
          ? baseline
          : null
    })

    // Cascade waterfall L(n+1).prime1 → prime2 → main → L(n+2)…, honouring Herald per-prime config.
    type CascadeTarget = {
      key: string
      bossName: string
      stageCode: string
      encounterIndex: 0 | 1 | 2
      capacity: number
    }

    // Keyed by `${canonical_key}|${rarity_set ?? ''}`; specific-stage rows beat the NULL catch-all.
    const heraldByCanonical = new Map<
      string,
      (typeof initialHeraldBossConfigs)[number]
    >()
    for (const entry of initialHeraldBossConfigs) {
      if (!entry.canonical_key) continue
      const catchAllKey = `${entry.canonical_key}|`
      if (!heraldByCanonical.has(catchAllKey) && entry.rarity_set === null) {
        heraldByCanonical.set(catchAllKey, entry)
      }
      if (entry.rarity_set !== null) {
        heraldByCanonical.set(
          `${entry.canonical_key}|${entry.rarity_set}`,
          entry
        )
      }
    }
    const resolveHerald = (mainBossDisplayName: string, raritySet: string) => {
      // `normalizeBossKey` yields the same form as the server's canonical_key.
      const norm = normalizeBossKey(mainBossDisplayName)
      return (
        heraldByCanonical.get(`${norm}|${raritySet}`) ??
        heraldByCanonical.get(`${norm}|`) ??
        null
      )
    }

    const cascadeTargets: CascadeTarget[] = []
    const sequence = queueViewData?.sequence ?? []
    const stageAssignmentsArr = queueViewData?.stage_assignments ?? []
    // Indexed by stageCode+loopIndex so ordering skew does not matter.
    const projectionsByStageKey = new Map<
      string,
      (typeof stageAssignmentsArr)[number]['projections']
    >()
    for (const sa of stageAssignmentsArr) {
      projectionsByStageKey.set(
        `${sa.stageCode}|${sa.loopIndex}`,
        sa.projections
      )
    }
    for (let i = 0; i < sequence.length; i++) {
      const stage = sequence[i]
      if (!stage) continue
      if (i === 0 || stage.isCurrentStage) continue
      const projections = projectionsByStageKey.get(
        `${stage.stageCode}|${stage.loopIndex}`
      )
      if (!projections) continue
      const heraldEntry = resolveHerald(stage.mainBoss, stage.stageCode)

      if (
        stage.prime1Boss &&
        projections.prime1 &&
        projections.prime1.startingHp > 0
      ) {
        const behaviour = heraldEntry?.side1_behaviour ?? 'kill'
        if (behaviour !== 'skip') {
          const thresholdHp =
            behaviour === 'threshold' &&
            typeof heraldEntry?.side1_threshold_hp_pct === 'number'
              ? projections.prime1.startingHp *
                (heraldEntry.side1_threshold_hp_pct / 100)
              : 0
          const capacity = Math.max(
            0,
            projections.prime1.startingHp - thresholdHp
          )
          if (capacity > 0) {
            cascadeTargets.push({
              key: `cascade:${stage.stageCode}:${stage.loopIndex}:1`,
              bossName: stage.prime1Boss,
              stageCode: stage.stageCode,
              encounterIndex: 1,
              capacity
            })
          }
        }
      }

      if (
        stage.prime2Boss &&
        projections.prime2 &&
        projections.prime2.startingHp > 0
      ) {
        const behaviour = heraldEntry?.side2_behaviour ?? 'kill'
        if (behaviour !== 'skip') {
          const thresholdHp =
            behaviour === 'threshold' &&
            typeof heraldEntry?.side2_threshold_hp_pct === 'number'
              ? projections.prime2.startingHp *
                (heraldEntry.side2_threshold_hp_pct / 100)
              : 0
          const capacity = Math.max(
            0,
            projections.prime2.startingHp - thresholdHp
          )
          if (capacity > 0) {
            cascadeTargets.push({
              key: `cascade:${stage.stageCode}:${stage.loopIndex}:2`,
              bossName: stage.prime2Boss,
              stageCode: stage.stageCode,
              encounterIndex: 2,
              capacity
            })
          }
        }
      }

      // Main: always 'kill' (Herald has no skip for mains).
      if (projections.main.startingHp > 0) {
        cascadeTargets.push({
          key: `cascade:${stage.stageCode}:${stage.loopIndex}:0`,
          bossName: stage.mainBoss,
          stageCode: stage.stageCode,
          encounterIndex: 0,
          capacity: projections.main.startingHp
        })
      }
    }

    // Shares `runningRemainingByTargetId` with native rows: one source of remaining HP.
    for (const t of cascadeTargets) {
      runningRemainingByTargetId.set(t.key, t.capacity)
    }

    const playersById = new Map(state.players.map((p) => [p.player_id, p]))

    // A redirect when under this share of the player's expected damage remains; killing blows stay.
    const CASCADE_OVERKILL_SHARE = 0.5

    rows.forEach((row) => {
      let currentRemaining = runningRemainingByTargetId.get(row.targetId)

      // Recomputed after cascade so the burn-down uses the cascade target's rate.
      let perAttackDamage =
        typeof row.avgDamage === 'number' &&
        Number.isFinite(row.avgDamage) &&
        row.avgDamage > 0
          ? row.avgDamage
          : DEFAULT_AVG_DAMAGE

      const cascadeNeeded =
        row.remaining > 0 &&
        typeof currentRemaining === 'number' &&
        Number.isFinite(currentRemaining) &&
        currentRemaining < perAttackDamage * CASCADE_OVERKILL_SHARE

      if (cascadeNeeded) {
        const player = playersById.get(row.playerId)
        // Best target by per-player avg damage, ties by waterfall order (no history: first wins).
        const scored = cascadeTargets
          .filter((t) => (runningRemainingByTargetId.get(t.key) ?? 0) > 0)
          .map((t) => {
            const score = player
              ? (lookupAvgDamageForPlayer(
                  state.performanceData,
                  player,
                  t.bossName,
                  currentStageCode
                ) ?? DEFAULT_AVG_DAMAGE)
              : DEFAULT_AVG_DAMAGE
            return { target: t, score }
          })
          .sort((a, b) => b.score - a.score)

        const best = scored[0]
        if (best) {
          row.cascadedFromTarget = row.target
          row.target = best.target.bossName
          row.targetId = best.target.key
          perAttackDamage = best.score
          const cap = runningRemainingByTargetId.get(best.target.key) ?? 0
          row.targetRemainingHp = cap
          currentRemaining = cap
        }
      }

      if (
        typeof currentRemaining !== 'number' ||
        !Number.isFinite(currentRemaining)
      ) {
        row.estHpRemaining = null
        return
      }

      const expectedDamage = perAttackDamage * row.remaining
      const after = Math.max(0, currentRemaining - expectedDamage)

      row.estHpRemaining = after
      runningRemainingByTargetId.set(row.targetId, after)
    })

    return rows
  }, [
    currentBossAttackStatsByPlayerId,
    currentBossTargets,
    currentBossHp.maxHp,
    currentBossHp.remainingHp,
    currentBossName,
    currentBossStatusQuery.data?.encounters,
    currentStageCode,
    initialBossHpData,
    mode,
    tokenStatusByPlayerId,
    state.performanceData,
    state.primeHpData,
    state.playerTokenAllocations,
    state.players,
    queueViewData?.stage_assignments,
    queueViewData?.sequence,
    initialHeraldBossConfigs,
    currentLoopIndex
  ])

  return currentBossRows
}
