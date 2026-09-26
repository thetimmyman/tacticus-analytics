import type { Supabase } from '../../types'
import { normalizeGuild } from '../../utils/formatting'
import {
  loadActiveRoster,
  isPlayerInRoster,
  resolveCanonicalDisplayName,
  createRosterPlayerKey
} from '../../utils/player-resolution'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import type { EOTGRData } from '@tacticus/app-core/types'

type RaidActivityRow = Pick<
  EOTGRData,
  | 'displayName'
  | 'userId'
  | 'Name'
  | 'damageDealt'
  | 'damageType'
  | 'startedOn'
  | 'completedOn'
>

type ProcessedRaidRow = {
  canonicalName: string
  playerKey: string
  damage: number
  damageType: 'Battle' | 'Bomb'
  bossName: string | null
  startedOn: string | null
  completedOn: string | null
}

export type RaidTrendPoint = {
  label: string
  value: number
}

export type RaidStatusSummary = {
  season: string
  guild: string
  guildLabel: string
  totalDamage: number
  totalBattles: number
  totalBombs: number
  activePlayers: number
  topPlayers: Array<{
    name: string
    damage: number
    battles: number
    bombs: number
  }>
  topBosses: Array<{
    name: string
    damage: number
    hits: number
  }>
  recentActivity: Array<{
    name: string
    bossName: string | null
    damage: number
    damageType: 'Battle' | 'Bomb'
    timestamp: string | null
  }>
  trend: RaidTrendPoint[]
}

export type RaidStatusSummaryResult =
  { ok: true; summary: RaidStatusSummary } | { ok: false; message: string }

const buildDateLabel = (date: Date) => {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}/${day}`
}

const resolveTimestamp = (row: ProcessedRaidRow) =>
  row.startedOn ?? row.completedOn ?? null

const buildTrend = (
  rows: ProcessedRaidRow[],
  days: number
): RaidTrendPoint[] => {
  const bucket = new Map<string, number>()
  rows.forEach((row) => {
    const timestamp = resolveTimestamp(row)
    if (!timestamp) return
    const dayKey = new Date(timestamp).toISOString().slice(0, 10)
    bucket.set(dayKey, (bucket.get(dayKey) ?? 0) + row.damage)
  })

  const latestRow = rows.find((row) => resolveTimestamp(row))
  const latestTimestamp = latestRow ? resolveTimestamp(latestRow) : null
  const anchorDate = latestTimestamp ? new Date(latestTimestamp) : new Date()
  const startDate = new Date(
    Date.UTC(
      anchorDate.getUTCFullYear(),
      anchorDate.getUTCMonth(),
      anchorDate.getUTCDate()
    )
  )
  startDate.setUTCDate(startDate.getUTCDate() - Math.max(0, days - 1))

  const points: RaidTrendPoint[] = []
  for (let i = 0; i < days; i += 1) {
    const current = new Date(startDate)
    current.setUTCDate(startDate.getUTCDate() + i)
    const dayKey = current.toISOString().slice(0, 10)
    points.push({
      label: buildDateLabel(current),
      value: bucket.get(dayKey) ?? 0
    })
  }

  return points
}

export async function fetchRaidStatusSummary(
  supabase: Supabase,
  {
    guild,
    season,
    guildLabel,
    recentLimit = 5,
    trendDays = 7
  }: {
    guild: string
    season: string
    guildLabel?: string
    recentLimit?: number
    trendDays?: number
  }
): Promise<RaidStatusSummaryResult> {
  const normalizedGuild = normalizeGuild(guild)
  const displayGuild = guildLabel || guild
  // canonicalName stays raw: it feeds grouping keys and roster matching.
  const memberLabels = await getMemberLabelMap()

  const [rosterResult, raidQuery] = await Promise.all([
    loadActiveRoster(supabase, [normalizedGuild]),
    supabase
      .from('EOT_GR_data')
      .select(
        'displayName, userId, Name, damageDealt, damageType, startedOn, completedOn'
      )
      .eq('Season', season)
      .eq('Guild', guild)
      .in('damageType', ['Battle', 'Bomb'])
      .order('startedOn', { ascending: false, nullsFirst: false })
  ])

  if (!rosterResult.ok) {
    return { ok: false, message: rosterResult.message }
  }
  const roster = rosterResult.roster
  const { data: raidData, error } = raidQuery

  if (error) {
    return { ok: false, message: `Failed to load raid data: ${error.message}` }
  }

  const raidRows: RaidActivityRow[] = raidData ?? []
  const processedRows: ProcessedRaidRow[] = []

  raidRows.forEach((record) => {
    const playerId = record.userId ?? null
    const rawDisplayName = record.displayName ?? record.userId ?? null

    if (!isPlayerInRoster(roster, playerId, rawDisplayName)) {
      return
    }

    const canonicalName = resolveCanonicalDisplayName(
      roster,
      playerId,
      rawDisplayName
    )
    const damage = Number(record.damageDealt ?? 0)
    const playerKey = createRosterPlayerKey(
      roster,
      normalizedGuild,
      playerId,
      canonicalName
    )

    processedRows.push({
      canonicalName,
      playerKey,
      damage,
      damageType: record.damageType as 'Battle' | 'Bomb',
      bossName: record.Name,
      startedOn: record.startedOn,
      completedOn: record.completedOn
    })
  })

  if (processedRows.length === 0) {
    return {
      ok: false,
      message: `No raid activity found for guild ${displayGuild} in season ${season} after filtering to active roster members.`
    }
  }

  let totalDamage = 0
  let totalBattles = 0
  let totalBombs = 0
  const uniquePlayers = new Set<string>()

  const playerTotals = new Map<
    string,
    { name: string; damage: number; battles: number; bombs: number }
  >()
  const bossTotals = new Map<string, { damage: number; hits: number }>()

  processedRows.forEach((row) => {
    totalDamage += row.damage
    if (row.damageType === 'Bomb') {
      totalBombs += 1
    } else {
      totalBattles += 1
    }

    uniquePlayers.add(row.playerKey)

    if (!playerTotals.has(row.playerKey)) {
      playerTotals.set(row.playerKey, {
        name: resolveMemberLabel(row.canonicalName, memberLabels),
        damage: 0,
        battles: 0,
        bombs: 0
      })
    }
    const playerStat = playerTotals.get(row.playerKey)!
    playerStat.damage += row.damage
    if (row.damageType === 'Bomb') {
      playerStat.bombs += 1
    } else {
      playerStat.battles += 1
    }

    const bossKey = row.bossName || 'Unknown'
    if (!bossTotals.has(bossKey)) {
      bossTotals.set(bossKey, { damage: 0, hits: 0 })
    }
    const bossStat = bossTotals.get(bossKey)!
    bossStat.damage += row.damage
    bossStat.hits += 1
  })

  const topPlayers = Array.from(playerTotals.values())
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 8)

  const topBosses = Array.from(bossTotals.entries())
    .sort((a, b) => b[1].damage - a[1].damage)
    .slice(0, 8)
    .map(([name, stat]) => ({ name, ...stat }))

  const recentActivity = processedRows.slice(0, recentLimit).map((row) => ({
    name: resolveMemberLabel(row.canonicalName, memberLabels),
    bossName: row.bossName,
    damage: row.damage,
    damageType: row.damageType,
    timestamp: resolveTimestamp(row)
  }))

  return {
    ok: true,
    summary: {
      season,
      guild,
      guildLabel: displayGuild,
      totalDamage,
      totalBattles,
      totalBombs,
      activePlayers: uniquePlayers.size,
      topPlayers,
      topBosses,
      recentActivity,
      trend: buildTrend(processedRows, trendDays)
    }
  }
}
