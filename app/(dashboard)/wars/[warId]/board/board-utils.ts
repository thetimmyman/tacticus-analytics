import type { PlayerStats, WarInfo } from '../../_types'
import {
  getAttackerLineup,
  isFailedAttack,
  type BattleSignalRow
} from '@/app/lib/war/battle-signals'

/** Raw unit jsonb blob of untrusted shape; narrow before use. */
export type RawUnitsJson = unknown

export type WarBattleRosterRow = FailureSignalRow & {
  attacker_player_id: string | null
  attacker_player_name: string | null
  defender_player_id: string | null
  defender_player_name: string | null
  /** Whether the ATTACKER is a member of the home guild (true), the opponent (false/null). */
  is_guild_member: boolean | null
  score_earned: number | null
}

export type WarBoardSides = {
  guild: PlayerStats[]
  opponent: PlayerStats[]
  /** Older wars lack failure-inference inputs: failed counts are unknowable, shown as "—". */
  failureDataAvailable: boolean
}

type Side = 'guild' | 'opponent'

const ROSTER_KEY_SEP = '\u0000'

function emptyPlayerStats(
  playerId: string,
  playerName: string,
  side: Side,
  tokens: number,
  score: number,
  failed: number
): PlayerStats {
  return {
    playerId,
    playerName,
    isGuildMember: side === 'guild',
    attacks: {
      total: tokens,
      wins: 0,
      losses: 0,
      points: score,
      perfect: 0,
      failed,
      winRate: 0,
      avgScore: 0
    },
    defenses: { total: 0, holds: 0, breaches: 0, conceded: 0, holdRate: 0 }
  }
}

const nonEmpty = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Per-battle PERSONAL-score cap: `score_earned` includes the guild's zone capture bonus. The
 * cap is the lower edge of the largest multiplicative gap above which only a small minority
 * sits; Infinity without captures.
 */
// Captures (~10k+) must also clear this floor, so early-war variation is not mistaken for one.
const MIN_CAPTURE_SCORE = 5000

export function captureScoreCap(scores: number[]): number {
  const positive = scores.filter((s) => s > 0).sort((a, b) => a - b)
  if (positive.length < 5) return Number.POSITIVE_INFINITY

  let cap = Number.POSITIVE_INFINITY
  // At least a 3x jump qualifies as the capture gap; pick the largest.
  let bestRatio = 3
  for (let i = 1; i < positive.length; i += 1) {
    const lower = positive[i - 1]
    const upper = positive[i]
    // Type-only guard for noUncheckedIndexedAccess; i is always in range.
    if (lower === undefined || upper === undefined || lower <= 0) continue
    const ratio = upper / lower
    const aboveFraction = (positive.length - i) / positive.length
    if (
      ratio > bestRatio &&
      aboveFraction <= 0.4 &&
      upper >= MIN_CAPTURE_SCORE
    ) {
      bestRatio = ratio
      cap = lower
    }
  }
  // First blood adds +1 and legit scores are multiples of 25, so the cap sheds the +1.
  if (Number.isFinite(cap) && cap % 25 === 1) cap -= 1
  return cap
}

/** Shared classifier row shape, so board and activity views cannot drift. */
export type FailureSignalRow = BattleSignalRow

/**
 * Failed = a recorded loss, else any defender left standing, else (no defender data) a full
 * attacker wipe. `score > 0` is not a win signal: failed attacks still earn score.
 */
export function isFailedBattleRow(row: FailureSignalRow): boolean {
  return isFailedAttack(row)
}

export function hasFailureData(rows: FailureSignalRow[]): boolean {
  return rows.some((row) => {
    if (row.attempt_result === 'loss') return true
    const attackerLineup = getAttackerLineup(row)
    return (
      (Array.isArray(row.defender_units_json) &&
        row.defender_units_json.length > 0) ||
      (attackerLineup !== null && attackerLineup.length > 0)
    )
  })
}

/**
 * Matches `get_war_player_stats`: attackers ∪ defenders (defence-only players get zeros), with
 * capture-magnitude scores clamped by {@link captureScoreCap}; attacker side = is_guild_member.
 */
export function buildBoardSides(rows: WarBattleRosterRow[]): WarBoardSides {
  // key = `${side}\0${playerId}`.
  const names = new Map<string, string>()
  const sides = new Map<string, Side>()
  const ids = new Map<string, string>()
  const tokens = new Map<string, number>()
  const scores = new Map<string, number>()
  const failures = new Map<string, number>()
  const sideScores: Record<Side, number[]> = { guild: [], opponent: [] }

  for (const row of rows) {
    if (!nonEmpty(row.attacker_player_id)) continue
    const side: Side = row.is_guild_member === true ? 'guild' : 'opponent'
    const score = Number(row.score_earned) || 0
    if (score > 0) sideScores[side].push(score)
  }

  const scoreCaps: Record<Side, number> = {
    guild: captureScoreCap(sideScores.guild),
    opponent: captureScoreCap(sideScores.opponent)
  }

  const register = (side: Side, id: string, name: string) => {
    const key = `${side}${ROSTER_KEY_SEP}${id}`
    if (!sides.has(key)) {
      sides.set(key, side)
      ids.set(key, id)
      names.set(key, name)
    } else if (!nonEmpty(names.get(key)) && nonEmpty(name)) {
      names.set(key, name)
    }
    return key
  }

  for (const row of rows) {
    const attackerIsGuild = row.is_guild_member === true
    const attackerSide: Side = attackerIsGuild ? 'guild' : 'opponent'
    const defenderSide: Side = attackerIsGuild ? 'opponent' : 'guild'

    if (nonEmpty(row.attacker_player_id)) {
      const id = row.attacker_player_id.trim()
      const key = register(
        attackerSide,
        id,
        nonEmpty(row.attacker_player_name)
          ? row.attacker_player_name.trim()
          : id
      )
      tokens.set(key, (tokens.get(key) ?? 0) + 1)
      const rawScore = Number(row.score_earned) || 0
      const cap = scoreCaps[attackerSide]
      // Only capture-magnitude attacks are capped; normal ones keep the first-blood +1.
      const score =
        Number.isFinite(cap) && rawScore >= MIN_CAPTURE_SCORE
          ? Math.min(rawScore, cap)
          : rawScore
      scores.set(key, (scores.get(key) ?? 0) + score)
      if (isFailedBattleRow(row)) {
        failures.set(key, (failures.get(key) ?? 0) + 1)
      }
    }

    if (nonEmpty(row.defender_player_id)) {
      const id = row.defender_player_id.trim()
      register(
        defenderSide,
        id,
        nonEmpty(row.defender_player_name)
          ? row.defender_player_name.trim()
          : id
      )
    }
  }

  const result: WarBoardSides = {
    guild: [],
    opponent: [],
    failureDataAvailable: hasFailureData(rows)
  }
  for (const key of sides.keys()) {
    const side = sides.get(key)!
    result[side].push(
      emptyPlayerStats(
        ids.get(key)!,
        names.get(key) ?? ids.get(key)!,
        side,
        tokens.get(key) ?? 0,
        scores.get(key) ?? 0,
        failures.get(key) ?? 0
      )
    )
  }
  return result
}

// Guild War is a fixed 30v30 format with 10 attack tokens per player.
export const WAR_ROSTER_SIZE = 30
export const TOKENS_PER_PLAYER = 10
export const GUILD_MAX_TOKENS = WAR_ROSTER_SIZE * TOKENS_PER_PLAYER

export type SideTotals = {
  totalTokens: number
  totalScore: number
  totalFailed: number
  participantCount: number
  /** Divided by the fixed 30 roster slots, matching the in-game board. */
  avgTokens: number
  avgScore: number
  pctUsed: number
}

/** Averages divide by {@link WAR_ROSTER_SIZE}, not participants, like in-game "Average / player". */
export function computeTotals(players: PlayerStats[]): SideTotals {
  const totalTokens = players.reduce((sum, p) => sum + p.attacks.total, 0)
  const totalScore = players.reduce((sum, p) => sum + p.attacks.points, 0)
  const totalFailed = players.reduce(
    (sum, p) => sum + (p.attacks.failed ?? 0),
    0
  )
  return {
    totalTokens,
    totalScore,
    totalFailed,
    participantCount: players.length,
    avgTokens: totalTokens / WAR_ROSTER_SIZE,
    avgScore: totalScore / WAR_ROSTER_SIZE,
    pctUsed: Math.round((totalTokens / GUILD_MAX_TOKENS) * 100)
  }
}

/** Sort by score desc, then tokens desc, then name — matches the in-game board. */
export function rankPlayers(players: PlayerStats[]): PlayerStats[] {
  return [...players].sort((a, b) => {
    if (b.attacks.points !== a.attacks.points) {
      return b.attacks.points - a.attacks.points
    }
    if (b.attacks.total !== a.attacks.total) {
      return b.attacks.total - a.attacks.total
    }
    return a.playerName.localeCompare(b.playerName)
  })
}

export type WarOutcome = 'guild' | 'opponent' | 'draw' | 'pending'

/** Recorded `war.result` (home perspective), else stored scores; `pending` until completed. */
export function resolveOutcome(war: WarInfo): WarOutcome {
  if (war.status !== 'completed') return 'pending'

  if (war.result === 'draw') return 'draw'
  if (war.result === 'win') return 'guild'
  if (war.result === 'loss') return 'opponent'

  if (war.guild.score > war.opponent.score) return 'guild'
  if (war.opponent.score > war.guild.score) return 'opponent'
  return 'draw'
}
