import type { Supabase } from '../../types'
import { normalizeGuild } from '../../utils/formatting'
import { rarityRank } from '@/app/lib/config'
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import { isSweepRow } from '@/app/lib/calculations/utils/sweep-helpers'
import {
  loadActiveRoster,
  isPlayerInRoster
} from '../../utils/player-resolution'
import type { EOTGRData } from '@tacticus/app-core/types'

type GuildPerformanceRow = Pick<
  EOTGRData,
  | 'displayName'
  | 'userId'
  | 'Name'
  | 'damageDealt'
  | 'remainingHp'
  | 'maxHp'
  | 'tier'
  | 'loopIndex'
  | 'rarity'
  | 'set'
>

export type BossLeaderboardEntry = {
  name: string
  level: string
  loop: number
  totalDamage: number
  attempts: number
  averageDamage: number
}

export type BossLeaderboardSummary = {
  season: string
  guild: string
  guildLabel: string
  totalDamage: number
  totalAttempts: number
  uniqueBosses: number
  leaderboard: BossLeaderboardEntry[]
}

export type BossLeaderboardResult =
  { ok: true; summary: BossLeaderboardSummary } | { ok: false; message: string }

export async function fetchBossLeaderboardSummary(
  supabase: Supabase,
  {
    guild,
    season,
    guildLabel,
    limit = 10
  }: { guild: string; season: string; guildLabel?: string; limit?: number }
): Promise<BossLeaderboardResult> {
  const normalizedGuild = normalizeGuild(guild)
  const displayGuild = guildLabel || guild

  const [rosterResult, bossQuery] = await Promise.all([
    loadActiveRoster(supabase, [normalizedGuild]),
    supabase
      .from('EOT_GR_data')
      .select(
        'displayName, userId, Name, damageDealt, remainingHp, maxHp, tier, loopIndex, rarity, set'
      )
      .eq('Season', season)
      .eq('Guild', guild)
      .eq('damageType', 'Battle')
      .order('startedOn', { ascending: false })
  ])

  if (!rosterResult.ok) {
    return { ok: false, message: rosterResult.message }
  }
  const roster = rosterResult.roster
  const { data: performanceData, error } = bossQuery

  if (error) {
    return {
      ok: false,
      message: `Failed to load boss statistics: ${error.message}`
    }
  }

  const performanceRows: GuildPerformanceRow[] = performanceData ?? []
  const filteredRows = performanceRows.filter((row) =>
    isPlayerInRoster(roster, row.userId ?? null, row.displayName ?? null)
  )

  if (filteredRows.length === 0) {
    return {
      ok: false,
      message: `No battle records found for guild ${displayGuild} in season ${season} (active roster only).`
    }
  }

  type BossAggregate = {
    name: string
    rarity: string | null
    set: number | null
    tier: number | null
    loop: number | null
    level: string
    totalDamage: number
    attempts: number
    meaningfulDamage: number
    meaningfulCount: number
  }

  const bossProgress: Record<string, BossAggregate> = {}
  let totalDamage = 0

  filteredRows.forEach((record) => {
    const rarity = record.rarity
    const setValue = record.set ?? null
    const tierValue = record.tier ?? null
    const loopIndex = record.loopIndex ?? null
    const level = getBossLevelFromSetAndRarity(
      setValue,
      rarity ?? '',
      tierValue
    )
    const loop = Number(loopIndex ?? 0)
    const bossName = record.Name || 'Unknown'
    const key = `${bossName}_${level}_L${loop}`

    if (!bossProgress[key]) {
      bossProgress[key] = {
        name: bossName,
        rarity,
        set: setValue ?? null,
        tier: tierValue ?? null,
        loop,
        level,
        totalDamage: 0,
        attempts: 0,
        meaningfulDamage: 0,
        meaningfulCount: 0
      }
    }

    const damage = Number(record.damageDealt) || 0
    bossProgress[key].totalDamage += damage
    bossProgress[key].attempts += 1
    totalDamage += damage
    // The average excludes crashes and sweeps (as on the web); totals stay raw.
    if (damage > 0 && !isSweepRow(record)) {
      bossProgress[key].meaningfulDamage += damage
      bossProgress[key].meaningfulCount += 1
    }
  })

  const leaderboard = Object.values(bossProgress)
    .sort((a, b) => {
      const rarityA = rarityRank(a.rarity)
      const rarityB = rarityRank(b.rarity)
      if (rarityA !== rarityB) return rarityB - rarityA

      const setA = a.set ?? a.tier ?? 0
      const setB = b.set ?? b.tier ?? 0
      if (setA !== setB) return setB - setA

      const loopA = a.loop ?? 0
      const loopB = b.loop ?? 0
      if (loopA !== loopB) return loopB - loopA

      return a.name.localeCompare(b.name)
    })
    .slice(0, limit)
    .map((boss) => ({
      name: boss.name,
      level: boss.level,
      loop: boss.loop ?? 0,
      totalDamage: boss.totalDamage,
      attempts: boss.attempts,
      averageDamage:
        boss.meaningfulCount > 0
          ? boss.meaningfulDamage / boss.meaningfulCount
          : 0
    }))

  return {
    ok: true,
    summary: {
      season,
      guild,
      guildLabel: displayGuild,
      totalDamage,
      totalAttempts: filteredRows.length,
      uniqueBosses: Object.keys(bossProgress).length,
      leaderboard
    }
  }
}
