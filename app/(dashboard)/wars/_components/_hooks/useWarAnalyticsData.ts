'use client'

import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import {
  countMedicaeForRow,
  inferAttackerUnitsLost,
  isAttemptWin,
  isFailedAttack,
  type BattleSignalRow
} from '@/app/lib/war/battle-signals'
import {
  cleanupAttemptKey,
  detectCleanupAttempts,
  attemptPlayerId
} from '@/app/lib/war/zone-chronology'
import type {
  PlayerActivity,
  PlayerAgg,
  RangeOption,
  WarRow,
  ZoneAgg
} from '../war-analytics-types'

export type {
  PlayerActivity,
  PlayerAgg,
  RangeOption,
  WarRow,
  ZoneAgg
} from '../war-analytics-types'

export { isAttemptWin }

// `zone_name` is not selected; names come from `zoneDisplayName(zone_type)` at render.
export type ZoneRow = {
  id: string
  war_id: string
  zone_type: string | null
}

export type AttemptRow = BattleSignalRow & {
  war_id: string
  // Aggregation key; player_name collides across members.
  player_id: string | null
  player_name: string | null
  is_guild_member: boolean | null
  zone_id: string | null
  damage_dealt: number | null
  score_earned: number | null
  attempt_result: string | null
  attempt_status: string | null
  attacker_units_lost: number | null
  attempt_end_time: string | null
}

/** Keyed by stable Loki userId (`player_id`); `label` is display-only. */
export type WarMember = {
  playerId: string
  label: string
}

export type WarPointsRow = {
  playerId: string
  player: string
  wars: number
  attempts: number
  total: number
  atk: number
  buf: number
  bon: number
  tok: number
  suc: number
  cnt16: number
  cnt14: number
  cnt12: number
  cnt11: number
  cln: number
  failN: number
  failM: number
}

export type WarPointsSummary = {
  players: WarPointsRow[]
  chartMax: number
  totalAttempts: number
}

const TOKENS_PER_WAR = 10

/**
 * Atk: 7 perfect oneshot, 6 oneshot 1-loss, 5 oneshot 2+ losses, 5 cleanup, 1 failed. Buf: +2 per active
 * medicae zone (max +4) on wins; failed on medicae = +1/+1. Bon: 5 for 9/10 wins, 10 for 10/10. Pen: -1 per unused token (10/war).
 */
const EMPTY_WAR_POINTS_ROW = {
  wars: 0,
  attempts: 0,
  total: 0,
  atk: 0,
  buf: 0,
  bon: 0,
  tok: 0,
  suc: 0,
  cnt16: 0,
  cnt14: 0,
  cnt12: 0,
  cnt11: 0,
  cln: 0,
  failN: 0,
  failM: 0
} as const

export const buildWarPointsScore = (
  attempts: AttemptRow[],
  allMembers: WarMember[] = []
): WarPointsSummary => {
  const labelById = new Map<string, string>(
    allMembers.map((m) => [m.playerId, m.label])
  )
  const guildAttempts = attempts.filter((a) => a.is_guild_member !== false)
  if (guildAttempts.length === 0) {
    const zeroes: WarPointsRow[] = [...allMembers]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((m) => ({
        playerId: m.playerId,
        player: m.label,
        ...EMPTY_WAR_POINTS_ROW
      }))
    return { players: zeroes, chartMax: 0, totalAttempts: 0 }
  }

  // A zone starts FRESH, a failure makes it WEAKENED, and the first win on WEAKENED is a cleanup.
  const cleanupAttempts = detectCleanupAttempts(guildAttempts)

  // Label: roster name, else battle name (ex-members), else the id.
  type PwStats = {
    playerId: string
    warId: string
    atk: number
    buf: number
    suc: number
    totalAttempts: number
    cnt16: number
    cnt14: number
    cnt12: number
    cnt11: number
    cln: number
    failN: number
    failM: number
  }
  const playerWarMap = new Map<string, PwStats>()
  const labelByPlayerId = new Map<string, string>()

  for (const a of guildAttempts) {
    const playerId = attemptPlayerId(a)
    if (!labelByPlayerId.has(playerId)) {
      const battleName = a.player_name?.trim()
      labelByPlayerId.set(
        playerId,
        labelById.get(playerId) ?? (battleName ? battleName : playerId)
      )
    }
    const warId = a.war_id
    const key = `${playerId}:${warId}`
    if (!playerWarMap.has(key)) {
      playerWarMap.set(key, {
        playerId,
        warId,
        atk: 0,
        buf: 0,
        suc: 0,
        totalAttempts: 0,
        cnt16: 0,
        cnt14: 0,
        cnt12: 0,
        cnt11: 0,
        cln: 0,
        failN: 0,
        failM: 0
      })
    }
    const pw = playerWarMap.get(key)!
    pw.totalAttempts += 1

    const medicaeCount = countMedicaeForRow(a)
    const attemptKey = cleanupAttemptKey(a)

    if (isFailedAttack(a)) {
      if (medicaeCount > 0) {
        pw.atk += 1
        pw.buf += 1
        pw.failM += 1
      } else {
        pw.atk += 1
        pw.failN += 1
      }
    } else {
      pw.suc += 1
      const isCleanup = cleanupAttempts.has(attemptKey)
      if (isCleanup) {
        pw.atk += 5
        pw.cln += 1
      } else {
        const lost = inferAttackerUnitsLost(a)
        if (lost === 0) {
          pw.atk += 7
          pw.cnt16 += 1
        } else if (lost === 1) {
          pw.atk += 6
          pw.cnt14 += 1
        } else if (lost === 2) {
          pw.atk += 5
          pw.cnt12 += 1
        } else {
          pw.atk += 5
          pw.cnt11 += 1
        }
      }
      if (medicaeCount > 0) pw.buf += medicaeCount * 2
    }
  }

  const playerTotals = new Map<
    string,
    Omit<WarPointsRow, 'player' | 'playerId'>
  >()

  for (const [, pw] of playerWarMap) {
    const bon = pw.suc >= 10 ? 10 : pw.suc === 9 ? 5 : 0
    const tok = -Math.max(0, TOKENS_PER_WAR - pw.totalAttempts)
    const warTotal = pw.atk + pw.buf + bon + tok

    const existing = playerTotals.get(pw.playerId)
    if (!existing) {
      playerTotals.set(pw.playerId, {
        wars: 1,
        attempts: pw.totalAttempts,
        total: warTotal,
        atk: pw.atk,
        buf: pw.buf,
        bon,
        tok,
        suc: pw.suc,
        cnt16: pw.cnt16,
        cnt14: pw.cnt14,
        cnt12: pw.cnt12,
        cnt11: pw.cnt11,
        cln: pw.cln,
        failN: pw.failN,
        failM: pw.failM
      })
    } else {
      existing.wars += 1
      existing.attempts += pw.totalAttempts
      existing.total += warTotal
      existing.atk += pw.atk
      existing.buf += pw.buf
      existing.bon += bon
      existing.tok += tok
      existing.suc += pw.suc
      existing.cnt16 += pw.cnt16
      existing.cnt14 += pw.cnt14
      existing.cnt12 += pw.cnt12
      existing.cnt11 += pw.cnt11
      existing.cln += pw.cln
      existing.failN += pw.failN
      existing.failM += pw.failM
    }
  }

  const players: WarPointsRow[] = [...playerTotals.entries()]
    .map(([playerId, s]) => ({
      playerId,
      player: labelByPlayerId.get(playerId) ?? 'Player',
      ...s
    }))
    .sort((a, b) => b.total - a.total)

  const participatedIds = new Set(players.map((p) => p.playerId))
  const absentees: WarPointsRow[] = allMembers
    .filter((m) => !participatedIds.has(m.playerId))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((m) => ({
      playerId: m.playerId,
      player: m.label,
      ...EMPTY_WAR_POINTS_ROW
    }))

  const chartMax = players.reduce((max, p) => Math.max(max, p.total), 0)
  return {
    players: [...players, ...absentees],
    chartMax,
    totalAttempts: guildAttempts.length
  }
}

// Module-level for a stable identity so downstream memos do not invalidate.
export const EMPTY_WAR_POINTS_SUMMARY: WarPointsSummary = buildWarPointsScore(
  []
)

export type WarAnalyticsData = {
  wars: WarRow[]
  players: PlayerAgg[]
  offenseZones: ZoneAgg[]
  defenseZones: ZoneAgg[]
  playerActivity: PlayerActivity[]
  warPoints: WarPointsSummary
  attempts: AttemptRow[]
  allMembers: WarMember[]
}

export function useWarAnalyticsData(guildCode: string, range: RangeOption) {
  return useQuery<WarAnalyticsData>({
    queryKey: ['war-analytics', guildCode, range],
    queryFn: async () => {
      const supabase = dbClient()

      const { data: warRows, error: warError } = await supabase
        .from('guild_war_matches')
        .select(
          'war_id, opponent_guild_name, war_result, guild_score, opponent_score, war_start_date, war_end_date, war_season, battlefield_level, raw_loki_data'
        )
        .eq('guild_code', guildCode)
        .eq('war_status', 'completed')
        .order('war_end_date', { ascending: false })
        .limit(50)

      if (warError) throw warError

      const allWars = (warRows ?? []) as unknown as WarRow[]
      const requestedCount =
        range === 'all'
          ? allWars.length
          : Math.min(parseInt(range, 10), allWars.length)
      const wars = allWars.slice(0, requestedCount)

      const warIds = wars
        .map((w) => w.war_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (warIds.length === 0) {
        return {
          wars: [],
          players: [],
          offenseZones: [],
          defenseZones: [],
          playerActivity: [],
          warPoints: buildWarPointsScore([]),
          attempts: [],
          allMembers: []
        }
      }

      const { data: zoneRows, error: zoneError } = await supabase
        .from('guild_war_zones')
        .select('id, war_id, zone_type')
        .eq('guild_code', guildCode)
        .in('war_id', warIds)

      if (zoneError) throw zoneError

      const zones = (zoneRows ?? []) as unknown as ZoneRow[]
      const zoneById = new Map<string, ZoneRow>()
      zones.forEach((zone) => {
        if (zone?.id) zoneById.set(zone.id, zone)
      })

      const { data: attemptRows, error: attemptError } = await supabase
        .from('guild_war_battles')
        .select(
          'war_id, player_id:attacker_player_id, player_name:attacker_player_name, is_guild_member, zone_id, damage_dealt, score_earned, attempt_result, attempt_status, buffs, raw_loki_data, attacker_units_json, defender_units_json, attacker_units_lost, attempt_end_time'
        )
        .eq('guild_code', guildCode)
        .in('war_id', warIds)
        .eq('attempt_status', 'completed')

      if (attemptError) throw attemptError

      const attempts = (attemptRows ?? []) as unknown as AttemptRow[]

      const { data: memberRows, error: memberError } = await guildRosterQuery(
        supabase,
        guildCode,
        'player_id, display_name'
      )

      if (memberError) throw memberError

      const memberLabelById = new Map<string, string>()
      const allMembers: WarMember[] = []
      for (const m of (memberRows ?? []) as {
        player_id: string | null
        display_name: string | null
      }[]) {
        if (!m.player_id || !m.display_name) continue
        if (memberLabelById.has(m.player_id)) continue
        memberLabelById.set(m.player_id, m.display_name)
        allMembers.push({ playerId: m.player_id, label: m.display_name })
      }

      const playerMap = new Map<
        string,
        {
          battleName: string | null
          wars: Set<string>
          attempts: number
          wins: number
          score: number
        }
      >()
      const offenseMap = new Map<
        string,
        { attempts: number; wins: number; score: number }
      >()
      const defenseMap = new Map<
        string,
        { attempts: number; wins: number; score: number }
      >()

      for (const attempt of attempts) {
        const score =
          typeof attempt.score_earned === 'number' ? attempt.score_earned : 0
        const warId = attempt.war_id
        const playerId = attempt.player_id
        const playerName = attempt.player_name
        const isGuildMember = attempt.is_guild_member === true
        const isOpponent = attempt.is_guild_member === false
        // Win = zone captured; the API reports 'win' for failed partial-damage attacks.
        const isWin = isAttemptWin(attempt)

        const zone = attempt.zone_id ? zoneById.get(attempt.zone_id) : undefined
        // 'unknown' is a real key (jammed-signal sentinel).
        const zoneType = zone?.zone_type ?? 'unknown'

        const playerKey = playerId?.trim()
          ? playerId.trim()
          : playerName?.trim()
            ? `legacy-name:${playerName.trim().toLocaleLowerCase()}`
            : null
        if (isGuildMember && playerKey) {
          const entry = playerMap.get(playerKey) ?? {
            battleName: null,
            wars: new Set<string>(),
            attempts: 0,
            wins: 0,
            score: 0
          }
          if (!entry.battleName && playerName?.trim()) {
            entry.battleName = playerName.trim()
          }
          entry.wars.add(warId)
          entry.attempts += 1
          entry.wins += isWin ? 1 : 0
          entry.score += score
          playerMap.set(playerKey, entry)
        }

        const bucket = isGuildMember
          ? offenseMap
          : isOpponent
            ? defenseMap
            : null
        if (bucket) {
          const key = zoneType
          const entry = bucket.get(key) ?? {
            attempts: 0,
            wins: 0,
            score: 0
          }
          entry.attempts += 1
          entry.wins += isWin ? 1 : 0
          entry.score += score
          bucket.set(key, entry)
        }
      }

      const players: PlayerAgg[] = [...playerMap.entries()]
        .map(([playerId, stats]) => {
          const attemptsCount = stats.attempts || 0
          const avgScore = attemptsCount > 0 ? stats.score / attemptsCount : 0
          const winRate =
            attemptsCount > 0 ? (stats.wins / attemptsCount) * 100 : 0
          return {
            playerId,
            player:
              memberLabelById.get(playerId) ?? stats.battleName ?? playerId,
            wars: stats.wars.size,
            attempts: attemptsCount,
            wins: stats.wins,
            score: stats.score,
            avgScore,
            winRate
          }
        })
        .sort((a, b) => b.score - a.score)

      const offenseZones: ZoneAgg[] = [...offenseMap.entries()]
        .map(([zoneType, stats]) => {
          const avgScore = stats.attempts > 0 ? stats.score / stats.attempts : 0
          const winRate =
            stats.attempts > 0 ? (stats.wins / stats.attempts) * 100 : 0
          return {
            zoneType,
            attempts: stats.attempts,
            wins: stats.wins,
            score: stats.score,
            avgScore,
            winRate
          }
        })
        .sort((a, b) => b.avgScore - a.avgScore)

      const defenseZones: ZoneAgg[] = [...defenseMap.entries()]
        .map(([zoneType, stats]) => {
          const avgScore = stats.attempts > 0 ? stats.score / stats.attempts : 0
          const winRate =
            stats.attempts > 0 ? (stats.wins / stats.attempts) * 100 : 0
          return {
            zoneType,
            attempts: stats.attempts,
            wins: stats.wins,
            score: stats.score,
            avgScore,
            winRate
          }
        })
        .sort((a, b) => a.avgScore - b.avgScore)

      const playerActivity: PlayerActivity[] = allMembers
        .map((member: WarMember) => {
          const stats = playerMap.get(member.playerId)
          const warsParticipated = stats?.wars.size ?? 0
          const participatedWarIds = stats?.wars ?? new Set<string>()

          // Only wars since first participation count, so new members are not penalised.
          let firstParticipationIdx = -1
          for (let i = wars.length - 1; i >= 0; i--) {
            const war = wars[i]
            if (war && participatedWarIds.has(war.war_id)) {
              firstParticipationIdx = i
              break
            }
          }
          const warsEligible =
            firstParticipationIdx >= 0 ? firstParticipationIdx + 1 : 0
          const participationRate =
            warsEligible > 0 ? (warsParticipated / warsEligible) * 100 : 100

          let lastActiveWarDate: string | null = null
          if (stats && stats.wars.size > 0) {
            const participatedWars = wars.filter((w) =>
              participatedWarIds.has(w.war_id)
            )
            const mostRecent = participatedWars.reduce(
              (latest, w) => {
                if (!latest || (w.war_end_date && w.war_end_date > latest))
                  return w.war_end_date
                return latest
              },
              null as string | null
            )
            lastActiveWarDate = mostRecent
          }

          const warsInactive = Math.max(0, warsEligible - warsParticipated)
          const attemptsCount = stats?.attempts ?? 0
          const winsCount = stats?.wins ?? 0
          const scoreTotal = stats?.score ?? 0

          return {
            playerId: member.playerId,
            player: member.label,
            warsParticipated,
            totalWars: warsEligible,
            participationRate,
            lastActiveWarDate,
            warsInactive,
            attempts: attemptsCount,
            wins: winsCount,
            score: scoreTotal,
            avgScore: attemptsCount > 0 ? scoreTotal / attemptsCount : 0,
            winRate: attemptsCount > 0 ? (winsCount / attemptsCount) * 100 : 0
          }
        })
        .sort(
          (a: PlayerActivity, b: PlayerActivity) =>
            a.participationRate - b.participationRate
        )

      const warPoints = buildWarPointsScore(attempts, allMembers)

      return {
        wars,
        players,
        offenseZones,
        defenseZones,
        playerActivity,
        warPoints,
        attempts,
        allMembers
      }
    },
    enabled: !!guildCode,
    staleTime: 60 * 1000
  })
}
