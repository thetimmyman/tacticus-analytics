// bephus-v1: win vs players = 2.50 + 0.25×medicae − 0.25×(5 − aliveAtStart) − 0.05×unitsLost;
// loss 1.00; NPC hit 1.25. Kill-share deliberately dominates efficiency.

import {
  countDefendersAliveAtStart,
  countMedicaeForRow,
  inferAttackerUnitsLost,
  isFailedAttack,
  isNpcDefenderBattle
} from './battle-signals'
import { attemptPlayerId, type ChronologyRow } from './zone-chronology'

export const BEPHUS_FORMULA_VERSION = 'bephus-v1'

export type RankingBattleRow = ChronologyRow & {
  score_earned?: number | null
  is_guild_member?: boolean | null
}

export type BattleScoreExclusionReason =
  | 'no-result'
  | 'no-before-hp'
  /** Win over zero alive defenders: corrupt row. */
  | 'no-defenders-alive'

export type BattleScore =
  | {
      kind: 'oneshot' | 'cleanup'
      multiplier: number
      defendersAliveAtStart: number
      attackerUnitsLost: number
      medicae: number
    }
  | { kind: 'loss'; multiplier: number }
  | { kind: 'npc'; multiplier: number }
  | { kind: 'excluded'; reason: BattleScoreExclusionReason }

const LOSS_MULTIPLIER = 1.0
const NPC_MULTIPLIER = 1.25
const WIN_BASE = 2.5
const MEDICAE_BONUS = 0.25
const DEAD_DEFENDER_PENALTY = 0.25
const UNIT_LOST_PENALTY = 0.05

const round2 = (n: number): number => Math.round(n * 100) / 100

export function scoreBattle(row: RankingBattleRow): BattleScore {
  if (row.attempt_result == null) {
    return { kind: 'excluded', reason: 'no-result' }
  }
  // Loss before NPC: a failed attack pays 1.00 whoever defended, else a wipe
  // against the NPC defense (1.25) would outrank a hard loss to a player.
  if (isFailedAttack(row)) {
    return { kind: 'loss', multiplier: LOSS_MULTIPLIER }
  }
  if (isNpcDefenderBattle(row)) {
    return { kind: 'npc', multiplier: NPC_MULTIPLIER }
  }
  const defendersAliveAtStart = countDefendersAliveAtStart(row)
  if (defendersAliveAtStart == null) {
    return { kind: 'excluded', reason: 'no-before-hp' }
  }
  if (defendersAliveAtStart < 1) {
    return { kind: 'excluded', reason: 'no-defenders-alive' }
  }
  const medicae = countMedicaeForRow(row)
  const attackerUnitsLost = inferAttackerUnitsLost(row)
  const multiplier = round2(
    WIN_BASE +
      MEDICAE_BONUS * medicae -
      DEAD_DEFENDER_PENALTY * (5 - defendersAliveAtStart) -
      UNIT_LOST_PENALTY * attackerUnitsLost
  )
  return {
    kind: defendersAliveAtStart >= 5 ? 'oneshot' : 'cleanup',
    multiplier,
    defendersAliveAtStart,
    attackerUnitsLost,
    medicae
  }
}

export type PlayerRankingRow = {
  playerId: string
  playerName: string | null
  battles: number
  scored: number
  oneshots: number
  cleanups: number
  losses: number
  npcHits: number
  excluded: number
  totalMultiplier: number
  avgMultiplier: number
  /** Capture-magnitude attacks clamped to the caller's per-war cap. */
  normalizedPoints: number
}

export type WarExclusion = {
  warId: string
  reason: string
}

export type PlayerRankingResult = {
  formulaVersion: typeof BEPHUS_FORMULA_VERSION
  players: PlayerRankingRow[]
  excludedWars: WarExclusion[]
  excludedBattles: Record<BattleScoreExclusionReason, number>
  scoredBattles: number
}

/** Opponent rows are ignored, as in War Points; wars without a `capByWarId` entry sum raw. */
export function buildPlayerRanking(
  rows: RankingBattleRow[],
  excludedWars: WarExclusion[],
  capByWarId: ReadonlyMap<string, number> = new Map()
): PlayerRankingResult {
  const excludedWarIds = new Set(excludedWars.map((w) => w.warId))
  const excludedBattles: Record<BattleScoreExclusionReason, number> = {
    'no-result': 0,
    'no-before-hp': 0,
    'no-defenders-alive': 0
  }

  type Acc = {
    playerName: string | null
    battles: number
    scored: number
    oneshots: number
    cleanups: number
    losses: number
    npcHits: number
    excluded: number
    totalMultiplier: number
    normalizedPoints: number
  }
  const byPlayer = new Map<string, Acc>()
  let scoredBattles = 0

  for (const row of rows) {
    // Strict: a NULL flag must never put an opponent on the guild leaderboard.
    if (row.is_guild_member !== true) continue
    if (excludedWarIds.has(row.war_id)) continue

    const playerId = attemptPlayerId(row)
    let acc = byPlayer.get(playerId)
    if (!acc) {
      acc = {
        playerName: row.player_name?.trim() || null,
        battles: 0,
        scored: 0,
        oneshots: 0,
        cleanups: 0,
        losses: 0,
        npcHits: 0,
        excluded: 0,
        totalMultiplier: 0,
        normalizedPoints: 0
      }
      byPlayer.set(playerId, acc)
    }
    acc.battles += 1

    const cap = capByWarId.get(row.war_id) ?? Number.POSITIVE_INFINITY
    const rawScore = typeof row.score_earned === 'number' ? row.score_earned : 0
    acc.normalizedPoints += Math.min(rawScore, cap)

    const score = scoreBattle(row)
    if (score.kind === 'excluded') {
      acc.excluded += 1
      excludedBattles[score.reason] += 1
      continue
    }
    acc.scored += 1
    scoredBattles += 1
    acc.totalMultiplier = round2(acc.totalMultiplier + score.multiplier)
    if (score.kind === 'oneshot') acc.oneshots += 1
    else if (score.kind === 'cleanup') acc.cleanups += 1
    else if (score.kind === 'loss') acc.losses += 1
    else acc.npcHits += 1
  }

  const players: PlayerRankingRow[] = [...byPlayer.entries()]
    .map(([playerId, acc]) => ({
      playerId,
      playerName: acc.playerName,
      battles: acc.battles,
      scored: acc.scored,
      oneshots: acc.oneshots,
      cleanups: acc.cleanups,
      losses: acc.losses,
      npcHits: acc.npcHits,
      excluded: acc.excluded,
      totalMultiplier: acc.totalMultiplier,
      avgMultiplier:
        acc.scored > 0 ? round2(acc.totalMultiplier / acc.scored) : 0,
      normalizedPoints: acc.normalizedPoints
    }))
    .sort(
      (a, b) =>
        b.totalMultiplier - a.totalMultiplier ||
        b.normalizedPoints - a.normalizedPoints ||
        a.playerId.localeCompare(b.playerId)
    )

  return {
    formulaVersion: BEPHUS_FORMULA_VERSION,
    players,
    excludedWars,
    excludedBattles,
    scoredBattles
  }
}
