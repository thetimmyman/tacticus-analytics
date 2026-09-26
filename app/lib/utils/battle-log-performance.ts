export interface PlayerBossPerformanceRow {
  display_name: string | null
  boss_name: string | null
  encounter_id: number | null
  set_num: number | null
  rarity: string | null
  player_vs_guild_avg: number | string | null
  player_vs_cluster_avg: number | string | null
}

const COMPARABLE_RARITIES = new Set(['Legendary', 'Mythic'])

export function shouldUsePerformancePct(
  damageType: string | null | undefined,
  rarity: string | null | undefined
): boolean {
  if (damageType !== 'Battle') return false
  if (!rarity) return false
  return COMPARABLE_RARITIES.has(rarity)
}

export function toNullableNumber(
  value: number | string | null | undefined
): number | null {
  if (value == null) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function buildPerformanceLookupKey(params: {
  displayName: string | null | undefined
  bossName: string | null | undefined
  encounterId: number | null | undefined
  setNum: number | null | undefined
  rarity: string | null | undefined
}): string {
  const displayName = (params.displayName ?? '').trim()
  const bossName = (params.bossName ?? '').trim()
  const encounterId = params.encounterId ?? 0
  const setNum = params.setNum ?? 0
  const rarity = params.rarity ?? ''
  return `${displayName}|${bossName}|${encounterId}|${setNum}|${rarity}`
}

export interface BattleLogPerformanceEntry {
  damageType?: string | null
  rarity?: string | null
  displayName?: string | null
  Name?: string | null
  encounterId?: number | null
  set?: number | null
}

export function getBattleLogPerformancePcts(
  entry: BattleLogPerformanceEntry,
  guildPerformancePctMap: ReadonlyMap<string, number | null>,
  clusterPerformancePctMap: ReadonlyMap<string, number | null>
): { guildPct: number | null; clusterPct: number | null } {
  if (!shouldUsePerformancePct(entry.damageType, entry.rarity)) {
    return { guildPct: null, clusterPct: null }
  }

  const key = buildPerformanceLookupKey({
    displayName: entry.displayName,
    bossName: entry.Name,
    encounterId: entry.encounterId,
    setNum: entry.set,
    rarity: entry.rarity
  })
  return {
    guildPct: guildPerformancePctMap.get(key) ?? null,
    clusterPct: clusterPerformancePctMap.get(key) ?? null
  }
}
