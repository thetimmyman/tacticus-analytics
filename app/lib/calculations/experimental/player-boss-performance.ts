import type { EOTGRData, TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

const logger = createComponentLogger(
  'lib.calculations.experimental.player-boss-performance'
)

export type PlayerBossPerformanceRow = {
  displayName: string
  user_id: string | null
  boss_name: string
  tier: number | null
  set: number | null
  rarity: string | null
  encounterId: number | null
  overallTokenUsage: string | null
  player_avg: number | null
  guild_avg: number | null
  cluster_avg: number | null
  battle_count: number | null
  weighted_contribution: number | null
  vs_cluster_pct: number | null
  vs_guild_pct: number | null
}

let singlePlayerRpcAvailable = true

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/** The 2-arg overload returns player_vs_*_avg, the 3-arg one vs_*_pct. */
export const normalizeRpcRow = (
  row: Record<string, unknown>
): PlayerBossPerformanceRow => {
  const bossName =
    (row.boss_name as string) ??
    (row.prime_name as string) ??
    (row.name as string) ??
    ''
  const encounterId =
    toNumber(row.encounter_id ?? row.encounterId ?? row.enc_id) ?? 0
  const setValue = toNumber(row.set ?? row.set_num ?? row.set_val) ?? null
  const rarity = (row.rarity as string) ?? (row.rarity_val as string) ?? null
  const tierValue = toNumber(row.tier ?? row.tier_val) ?? null
  const battleCount =
    toNumber(
      row.battle_count ?? row.b_count ?? row.battles ?? row.battles_fought
    ) ?? 0

  const playerAvg =
    toNumber(row.player_avg ?? row.avg_player_damage ?? row.avg_damage) ?? 0
  const guildAvg = toNumber(row.guild_avg ?? row.avg_guild_damage) ?? 0
  const clusterAvg = toNumber(row.cluster_avg) ?? 0
  let vsGuild = toNumber(row.vs_guild_pct ?? row.player_vs_guild_avg)
  let vsCluster = toNumber(row.vs_cluster_pct ?? row.player_vs_cluster_avg)

  if ((vsGuild === null || vsGuild === undefined) && guildAvg > 0) {
    vsGuild = (playerAvg / guildAvg - 1) * 100
  }
  if ((vsCluster === null || vsCluster === undefined) && clusterAvg > 0) {
    vsCluster = (playerAvg / clusterAvg - 1) * 100
  }
  if (vsGuild === null || vsGuild === undefined) vsGuild = 0
  if (vsCluster === null || vsCluster === undefined) vsCluster = 0
  const weightedContribution = toNumber(row.weighted_contribution)

  const displayName =
    (row.display_name as string) ?? (row.displayName as string) ?? ''
  const overallTokenUsage =
    (row.token_usage_label as string) ??
    (row.overallTokenUsage as string) ??
    (encounterId === 0
      ? setValue !== null
        ? `L${setValue + 1} ${bossName}`
        : bossName
      : 'Primes')

  return {
    displayName,
    user_id: (row.user_id as string) ?? null,
    boss_name: bossName,
    tier: tierValue,
    set: setValue,
    rarity,
    encounterId,
    overallTokenUsage,
    player_avg: playerAvg,
    guild_avg: guildAvg,
    cluster_avg: clusterAvg,
    battle_count: battleCount,
    weighted_contribution: weightedContribution,
    vs_cluster_pct: vsCluster,
    vs_guild_pct: vsGuild
  }
}

const isEncounterAmbiguityError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const message = (error as { message?: unknown }).message
  const code = (error as { code?: unknown }).code
  return (
    (typeof message === 'string' &&
      message.toLowerCase().includes('encounterid') &&
      message.toLowerCase().includes('ambiguous')) ||
    code === '42702'
  )
}

const isRpcTypeMismatch = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const message = (error as { message?: unknown }).message
  const code = (error as { code?: unknown }).code
  return (
    code === '42804' ||
    (typeof message === 'string' &&
      message.toLowerCase().includes('does not match expected type'))
  )
}

type RawBattleRow = Partial<
  Pick<
    EOTGRData,
    | 'displayName'
    | 'Name'
    | 'encounterId'
    | 'damageDealt'
    | 'damageType'
    | 'rarity'
    | 'set'
    | 'tier'
    | 'remainingHp'
    | 'maxHp'
    | 'Guild'
  >
>

const isSweep = (row: RawBattleRow): boolean => {
  const remaining = row.remainingHp ?? null
  const max = row.maxHp ?? null
  const dmg = row.damageDealt ?? null
  if (remaining === null || max === null || dmg === null) return false
  return (
    remaining === 0 &&
    max > 0 &&
    dmg < max &&
    (row.damageType ?? '') === 'Battle'
  )
}

const buildBossKey = (
  name?: string | null,
  rarity?: string | null,
  set?: number | null
) => `${name ?? ''}_${rarity ?? ''}_${set ?? 0}`

const computeFromTables = async (
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string,
  displayName?: string
): Promise<PlayerBossPerformanceRow[]> => {
  if (!displayName) {
    return []
  }

  const { data: playerRowsRaw, error: playerError } = await supabase
    .from('EOT_GR_data')
    .select(
      'displayName, Name, encounterId, damageDealt, damageType, rarity, set, tier, remainingHp, maxHp'
    )
    .eq('Season', season)
    .eq('Guild', guildCode)
    .eq('damageType', 'Battle')
    .in('rarity', ['Legendary', 'Mythic'])
    .eq('displayName', displayName)
    .gt('damageDealt', 0)
    .order('startedOn', { ascending: false })

  if (playerError) {
    throw playerError
  }

  const playerRows: RawBattleRow[] = Array.isArray(playerRowsRaw)
    ? playerRowsRaw
    : []
  const filteredPlayerRows = playerRows.filter((row) => !isSweep(row))

  const { data: guildRowsRaw, error: guildError } = await supabase
    .from('EOT_GR_data')
    .select(
      'Name, encounterId, damageDealt, damageType, rarity, set, tier, remainingHp, maxHp'
    )
    .eq('Season', season)
    .eq('Guild', guildCode)
    .eq('damageType', 'Battle')
    .in('rarity', ['Legendary', 'Mythic'])
    .gt('damageDealt', 0)
    .order('startedOn', { ascending: false })

  if (guildError) {
    throw guildError
  }

  const guildRows: RawBattleRow[] = Array.isArray(guildRowsRaw)
    ? guildRowsRaw
    : []
  const filteredGuildRows = guildRows.filter((row) => !isSweep(row))

  let clusterCode: string | null = null
  try {
    const gc = await GuildConfigService.getBasic(supabase, guildCode)
    if (gc?.cluster_code) {
      clusterCode = gc.cluster_code
    }
  } catch {
    clusterCode = null
  }

  let clusterRows: RawBattleRow[] = []
  if (clusterCode) {
    const { data: clusterRowsRaw } = await supabase
      .from('EOT_GR_data')
      .select(
        'Name, encounterId, damageDealt, damageType, rarity, set, tier, remainingHp, maxHp, Guild, cluster_code'
      )
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .in('rarity', ['Legendary', 'Mythic'])
      .gt('damageDealt', 0)
      .eq('cluster_code', clusterCode)
      .order('startedOn', { ascending: false })
    clusterRows = Array.isArray(clusterRowsRaw)
      ? clusterRowsRaw.filter((row) => !isSweep(row))
      : []
  }

  const guildAvgMap = new Map<string, number>()
  filteredGuildRows.forEach((row) => {
    const key = buildBossKey(row.Name, row.rarity, row.set)
    const dmg = Number(row.damageDealt ?? 0)
    if (!guildAvgMap.has(key)) {
      guildAvgMap.set(key, 0)
    }
    const current = guildAvgMap.get(key) ?? 0
    guildAvgMap.set(key, current + dmg)
  })
  const guildCountMap = new Map<string, number>()
  filteredGuildRows.forEach((row) => {
    const key = buildBossKey(row.Name, row.rarity, row.set)
    guildCountMap.set(key, (guildCountMap.get(key) ?? 0) + 1)
  })
  guildAvgMap.forEach((sum, key) => {
    const count = guildCountMap.get(key) ?? 1
    guildAvgMap.set(key, count > 0 ? sum / count : 0)
  })

  const clusterAvgMap = new Map<string, number>()
  if (clusterRows.length > 0) {
    const clusterSum = new Map<string, number>()
    const clusterCount = new Map<string, number>()
    clusterRows.forEach((row) => {
      const key = buildBossKey(row.Name, row.rarity, row.set)
      clusterSum.set(
        key,
        (clusterSum.get(key) ?? 0) + Number(row.damageDealt ?? 0)
      )
      clusterCount.set(key, (clusterCount.get(key) ?? 0) + 1)
    })
    clusterSum.forEach((sum, key) => {
      const count = clusterCount.get(key) ?? 1
      clusterAvgMap.set(key, count > 0 ? sum / count : 0)
    })
  }

  const playerGroups = new Map<
    string,
    {
      total: number
      count: number
      set: number | null
      tier: number | null
      rarity: string | null
      encounterId: number
    }
  >()

  filteredPlayerRows.forEach((row) => {
    const key = buildBossKey(row.Name, row.rarity, row.set)
    const existing = playerGroups.get(key) ?? {
      total: 0,
      count: 0,
      set: row.set ?? null,
      tier: row.tier ?? null,
      rarity: row.rarity ?? null,
      encounterId: row.encounterId ?? 0
    }
    existing.total += Number(row.damageDealt ?? 0)
    existing.count += 1
    if (existing.set === null) existing.set = row.set ?? null
    if (existing.tier === null) existing.tier = row.tier ?? null
    if (existing.rarity === null) existing.rarity = row.rarity ?? null
    if (!existing.encounterId && typeof row.encounterId === 'number') {
      existing.encounterId = row.encounterId
    }
    playerGroups.set(key, existing)
  })

  const results: PlayerBossPerformanceRow[] = []
  playerGroups.forEach((val, key) => {
    const playerAvg = val.count > 0 ? val.total / val.count : 0
    const guildAvg = guildAvgMap.get(key) ?? 0
    const clusterAvg = clusterAvgMap.get(key) ?? 0
    const vsGuild = guildAvg > 0 ? (playerAvg / guildAvg - 1) * 100 : 0
    const vsCluster = clusterAvg > 0 ? (playerAvg / clusterAvg - 1) * 100 : 0
    const nameOnly = key.split('_')[0]
    const overallTokenUsage =
      val.encounterId === 0
        ? `L${(val.set ?? 0) + 1} ${nameOnly}`
        : 'Leg. Primes'

    results.push({
      displayName,
      user_id: null,
      boss_name: key,
      tier: val.tier,
      set: val.set,
      rarity: val.rarity,
      encounterId: val.encounterId,
      overallTokenUsage,
      player_avg: playerAvg,
      guild_avg: guildAvg,
      cluster_avg: clusterAvg,
      battle_count: val.count,
      weighted_contribution: null,
      vs_cluster_pct: vsCluster,
      vs_guild_pct: vsGuild
    })
  })

  return results
}

const fetchPrimeRows = async (
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<Record<string, unknown>[]> => {
  const { data, error } = (await supabase.rpc('get_player_prime_performance', {
    guild_code_param: guildCode,
    season_param: season
  })) as { data: Record<string, unknown>[] | null; error: Error | null }

  if (error) {
    throw error
  }
  return Array.isArray(data) ? data : []
}

export async function getPlayerBossPerformanceRPC(
  supabase: TypedSupabaseClient,
  filters: {
    Guild: string
    Season: string
    displayName?: string
    rarities?: string[]
  }
): Promise<PlayerBossPerformanceRow[]> {
  const guildCode = filters.Guild?.trim()
  const season = filters.Season?.trim()
  const displayName = filters.displayName?.trim()

  if (!guildCode || !season) {
    return []
  }

  // The single-player RPC can fail (e.g. ambiguous encounterId); fall back to the guild-wide one.
  if (displayName && singlePlayerRpcAvailable) {
    try {
      const rpcParams = {
        p_guild_code: guildCode,
        p_season: season,
        p_display_name: displayName,
        ...(filters.rarities && filters.rarities.length > 0
          ? { p_rarities: filters.rarities }
          : {})
      }

      // The `p_rarities` overload is missing from generated types.
      /* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-syntax */
      const { data, error } = (await supabase.rpc(
        'get_player_boss_performance',
        rpcParams as any
      )) as unknown as {
        data: Record<string, unknown>[] | null
        error: Error | null
      }
      /* eslint-enable @typescript-eslint/no-explicit-any, no-restricted-syntax */

      if (error) {
        throw error
      }

      const rows = Array.isArray(data) ? data : []

      let primeRows: Record<string, unknown>[] = []
      try {
        primeRows = await fetchPrimeRows(supabase, guildCode, season)
      } catch (primeError) {
        logger.warn(
          { err: primeError, guildCode, season },
          'Failed to fetch prime-boss rows; returning main-boss rows only'
        )
      }

      return [...rows, ...primeRows].map(normalizeRpcRow)
    } catch (error) {
      if (isEncounterAmbiguityError(error) || isRpcTypeMismatch(error)) {
        singlePlayerRpcAvailable = false
      } else {
        logger.warn(
          { err: error, guildCode, season },
          'Single-player boss-performance RPC failed unexpectedly; using guild-wide fallback'
        )
      }
    }
  }

  const { data: guildData, error: guildError } = (await supabase.rpc(
    'get_player_boss_performance',
    {
      guild_code_param: guildCode,
      season_param: season
    }
  )) as { data: Record<string, unknown>[] | null; error: Error | null }

  const { data: primeData, error: primeError } = (await supabase.rpc(
    'get_player_prime_performance',
    {
      guild_code_param: guildCode,
      season_param: season
    }
  )) as { data: Record<string, unknown>[] | null; error: Error | null }

  const allRpcFailed =
    (!!guildError || !Array.isArray(guildData)) &&
    (!!primeError || !Array.isArray(primeData))
  if (allRpcFailed) {
    return computeFromTables(supabase, guildCode, season, displayName)
  }

  const rows: Record<string, unknown>[] = []
  if (Array.isArray(guildData)) rows.push(...guildData)
  if (Array.isArray(primeData)) rows.push(...primeData)

  const normalized = rows.map(normalizeRpcRow)

  if (!displayName) {
    return normalized
  }

  const target = displayName.toLowerCase()
  return normalized.filter(
    (row) => (row.displayName || '').toLowerCase() === target
  )
}
