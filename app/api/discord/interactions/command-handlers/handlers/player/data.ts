import type { Supabase } from '../../types'
import { getCurrentSeason } from '../tokens/shared'
import { resolveGuildDisplayLabel } from '@/app/api/discord/guild-label'
import {
  resolveAllowedGuilds,
  resolvePlayerByName
} from '../../utils/player-resolution'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import type { EOTGRData } from '@tacticus/app-core/types'

type PlayerStatsRow = Pick<
  EOTGRData,
  'Name' | 'Guild' | 'damageDealt' | 'damageType'
>

export type PlayerBossStats = {
  name: string
  battles: number
  bombs: number
  totalDamage: number
  topDamage: number
}

export type PlayerStatsSummary = {
  season: string
  playerName: string
  displayName: string
  guild: string
  guildLabel: string
  totalDamage: number
  totalBattles: number
  totalBombs: number
  uniqueBosses: number
  bossBreakdown: PlayerBossStats[]
  topBoss?: PlayerBossStats
  biggestHit?: { bossName: string; value: number }
}

export type PlayerStatsResult =
  { ok: true; summary: PlayerStatsSummary } | { ok: false; message: string }

export async function fetchPlayerStatsSummary(
  supabase: Supabase,
  {
    playerName,
    season,
    linkedGuilds,
    requestedGuild
  }: {
    playerName: string
    season?: string
    linkedGuilds: string[]
    requestedGuild?: string | null
  }
): Promise<PlayerStatsResult> {
  const scopeResult = resolveAllowedGuilds({ linkedGuilds, requestedGuild })
  if (!scopeResult.ok) {
    return scopeResult
  }
  const { allowedGuilds, resolvedRequestedGuild } = scopeResult.scope

  const [resolvedSeason, playerResult] = await Promise.all([
    season ? Promise.resolve(season) : getCurrentSeason(supabase),
    resolvePlayerByName(supabase, {
      playerName,
      allowedGuilds,
      requestedGuild: resolvedRequestedGuild
    })
  ])

  if (!playerResult.ok) {
    return playerResult
  }

  const { player } = playerResult

  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select('Name, Guild, damageDealt, damageType')
    .eq('Season', resolvedSeason)
    .eq('userId', player.playerId)
    .in('Guild', allowedGuilds)
    .in('damageType', ['Battle', 'Bomb'])
    .order('startedOn', { ascending: false })

  if (error) {
    return {
      ok: false,
      message: `Failed to load player statistics: ${error.message}`
    }
  }

  const playerRows: PlayerStatsRow[] = data ?? []

  if (playerRows.length === 0) {
    // Only for the "no data" message; displayName stays raw (chart-URL key).
    const memberLabels = await getMemberLabelMap()
    return {
      ok: false,
      message: `No data found for player ${resolveMemberLabel(player.displayName, memberLabels)} in season ${resolvedSeason}.`
    }
  }

  const bossMap = new Map<string, PlayerBossStats>()
  const guild = playerRows[0]?.Guild || player.guildCode || 'Unknown'
  const guildLabel = await resolveGuildDisplayLabel(supabase, guild)

  let totalDamage = 0
  let totalBattles = 0
  let totalBombs = 0
  let biggestHit: { bossName: string; value: number } | undefined

  playerRows.forEach((record) => {
    const bossName = record.Name || 'Unknown'
    if (!bossMap.has(bossName)) {
      bossMap.set(bossName, {
        name: bossName,
        battles: 0,
        bombs: 0,
        totalDamage: 0,
        topDamage: 0
      })
    }

    const stats = bossMap.get(bossName)!
    const damage = Number(record.damageDealt) || 0

    if (record.damageType === 'Battle') {
      stats.battles += 1
      totalBattles += 1
    } else if (record.damageType === 'Bomb') {
      stats.bombs += 1
      totalBombs += 1
    }

    stats.totalDamage += damage
    stats.topDamage = Math.max(stats.topDamage, damage)
    totalDamage += damage

    if (!biggestHit || damage > biggestHit.value) {
      biggestHit = { bossName, value: damage }
    }
  })

  const bossBreakdown = Array.from(bossMap.values()).sort(
    (a, b) => b.totalDamage - a.totalDamage
  )

  return {
    ok: true,
    summary: {
      season: resolvedSeason,
      playerName: playerName.trim(),
      displayName: player.displayName,
      guild,
      guildLabel,
      totalDamage,
      totalBattles,
      totalBombs,
      uniqueBosses: bossBreakdown.length,
      bossBreakdown,
      topBoss: bossBreakdown[0],
      biggestHit
    }
  }
}
