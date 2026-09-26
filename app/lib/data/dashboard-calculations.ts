import { assertClientSession, authenticatedDbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.dashboard-calculations')

export interface TokenUsageByLoopRow {
  loop_index: number
  bosses: number
  primes: number
  rarities: string[]
}

export interface TokenUsageByLoopResult {
  [loopIndex: number]: {
    bosses: number
    primes: number
    rarities: string[]
    displayLoop: number
  }
}

export interface TokenUsageByLoopAndSetRow {
  loop_index: number
  set_key: string
  token_count: number
}

export interface TokenUsageByLoopAndSetResult {
  [loopIndex: number]: {
    [setKey: string]: number
    total: number
  }
}

export interface DamageByBossLoopRow {
  loop_index: number
  boss_display_name: string
  avg_damage: number
  max_damage: number
  total_damage: number
  hit_count: number
  start_time: string | null
  end_time: string | null
  is_prime: boolean
  sweep_count?: number
  one_shot_count?: number
  crash_count?: number
  eff_avg_damage?: number | null
}

export interface DamageByBossLoopResult {
  data: Array<{
    loop: number
    [bossName: string]: number | null
  }>
  bosses: string[]
  detailedData: Array<{
    loop: number
    bossName: string
    avgDamage: number
    maxDamage: number
    totalDamage: number
    hitCount: number
    startTime: string | null
    endTime: string | null
    isPrime: boolean
  }>
}

export interface BossDifficultyRow {
  boss_name: string
  display_name: string
  rarity: string
  set_num: number
  encounter_id: number
  avg_attempts: number
  avg_time_minutes: number
  hit_count: number
  total_damage: number
  completed_loops: number
  total_loops: number
  completion_rate: number
  avg_damage_per_attempt: number
}

export interface BossDifficultyResult {
  name: string
  displayName: string
  tier: string
  set: number
  rarity: string
  encounterId: number
  attempts: number
  timeMinutes: number
  hitCount: number
  totalDamage: number
  completedLoops: number
  totalLoops: number
  completionRate: number
  avgDamagePerAttempt: number
}

export async function getTokenUsageByLoop(
  guildCode: string,
  season: string,
  rarities: string[] = ['Legendary', 'Mythic']
): Promise<TokenUsageByLoopResult> {
  await assertClientSession()
  const supabase = authenticatedDbClient()

  const { data, error } = await supabase.rpc('get_token_usage_by_loop', {
    p_guild_code: guildCode,
    p_season: season,
    p_rarities: rarities
  })

  if (error) {
    logger.error(
      { guildCode, season, error },
      'Error fetching token usage by loop:'
    )
    return {}
  }

  const rows = (data || []) as TokenUsageByLoopRow[]
  const result: TokenUsageByLoopResult = {}

  for (const row of rows) {
    result[row.loop_index] = {
      bosses: row.bosses,
      primes: row.primes,
      rarities: row.rarities || [],
      displayLoop: row.loop_index
    }
  }

  return result
}

export async function getTokenUsageByLoopAndSet(
  guildCode: string,
  season: string,
  rarities: string[] = ['Legendary', 'Mythic']
): Promise<TokenUsageByLoopAndSetResult> {
  await assertClientSession()
  const supabase = authenticatedDbClient()

  const { data, error } = await supabase.rpc(
    'get_token_usage_by_loop_and_set',
    {
      p_guild_code: guildCode,
      p_season: season,
      p_rarities: rarities
    }
  )

  if (error) {
    logger.error(
      { guildCode, season, error },
      'Error fetching token usage by loop and set:'
    )
    throw error
  }

  const rows = (data || []) as TokenUsageByLoopAndSetRow[]

  if (rows.length === 0) {
    logger.warn(
      {
        guildCode,
        season,
        rarities,
        hint: 'Check if loopIndex is populated in EOT_GR_data and RPC function is deployed'
      },
      'Token usage by loop and set returned empty results'
    )
  }

  const result: TokenUsageByLoopAndSetResult = {}

  for (const row of rows) {
    const loopIndex = row.loop_index
    const setKey = row.set_key
    if (loopIndex === null || loopIndex === undefined || !setKey) {
      continue
    }
    if (!result[loopIndex]) {
      result[loopIndex] = { total: 0 }
    }
    result[loopIndex][setKey] = row.token_count
    result[loopIndex].total += row.token_count
  }

  return result
}

export async function getDamageByBossLoop(
  guildCode: string,
  season: string
): Promise<DamageByBossLoopResult> {
  await assertClientSession()
  const supabase = authenticatedDbClient()

  const { data, error } = await supabase.rpc('get_damage_by_boss_loop', {
    p_guild_code: guildCode,
    p_season: season
  })

  if (error) {
    logger.error(
      { guildCode, season, error },
      'Error fetching damage by boss loop:'
    )
    return { data: [], bosses: [], detailedData: [] }
  }

  const rows = (data || []) as DamageByBossLoopRow[]

  const loopMap = new Map<number, Record<string, number | null>>()
  const allBosses = new Set<string>()
  const primeData = new Map<number, { total: number; count: number }>()
  const detailedData = []

  for (const row of rows) {
    if (!loopMap.has(row.loop_index)) {
      loopMap.set(row.loop_index, { loop: row.loop_index })
    }

    const loopData = loopMap.get(row.loop_index)!
    loopData[row.boss_display_name] = Number(row.avg_damage)
    allBosses.add(row.boss_display_name)

    detailedData.push({
      loop: row.loop_index,
      bossName: row.boss_display_name,
      avgDamage: Number(row.avg_damage),
      maxDamage: Number(row.max_damage),
      totalDamage: Number(row.total_damage),
      hitCount: Number(row.hit_count),
      startTime: row.start_time,
      endTime: row.end_time,
      isPrime: row.is_prime
    })

    if (row.is_prime) {
      if (!primeData.has(row.loop_index)) {
        primeData.set(row.loop_index, { total: 0, count: 0 })
      }
      const pd = primeData.get(row.loop_index)!
      pd.total += Number(row.avg_damage)
      pd.count += 1
    }
  }

  primeData.forEach((pd, loopIndex) => {
    const loopData = loopMap.get(loopIndex)
    if (loopData && pd.count > 0) {
      loopData['All Primes'] = Math.round(pd.total / pd.count)
    }
  })

  const sortedBosses = Array.from(allBosses).sort((a, b) => {
    const aMatch = a.match(/^([ML])(\d+)\s/)
    const bMatch = b.match(/^([ML])(\d+)\s/)

    if (!aMatch || !bMatch) return a.localeCompare(b)

    const [, aRarity, aLevel] = aMatch
    const [, bRarity, bLevel] = bMatch

    if (aRarity === 'M' && bRarity === 'L') return -1
    if (aRarity === 'L' && bRarity === 'M') return 1

    return parseInt(bLevel ?? '0', 10) - parseInt(aLevel ?? '0', 10)
  })

  const resultData = Array.from(loopMap.values()).sort(
    (a, b) => (a.loop as number) - (b.loop as number)
  ) as Array<{ loop: number; [bossName: string]: number | null }>

  return {
    data: resultData,
    bosses: [...sortedBosses, 'All Primes'],
    detailedData: detailedData.sort((a, b) => {
      if (a.loop !== b.loop) return a.loop - b.loop
      return a.bossName.localeCompare(b.bossName)
    })
  }
}

export interface PlayerDamageByBossLoopResult {
  detailedData: Array<{
    loop: number
    bossName: string
    avgDamage: number
    maxDamage: number
    totalDamage: number
    hitCount: number
    startTime: string | null
    endTime: string | null
    isPrime: boolean
    sweepCount: number
    oneShotCount: number
    crashCount: number
    effAvgDamage: number | null
  }>
}

type PlayerDamageByBossLoopRpcClient = {
  rpc(
    fn: 'get_player_damage_by_boss_loop',
    args: {
      p_guild_code: string
      p_season: string
      p_display_name: string
    }
  ): Promise<{ data: DamageByBossLoopRow[] | null; error: unknown }>
}

export async function getPlayerDamageByBossLoop(
  guildCode: string,
  season: string,
  displayName: string
): Promise<PlayerDamageByBossLoopResult> {
  await assertClientSession()
  const supabase = authenticatedDbClient()
  const playerDamageRpc = supabase as unknown as PlayerDamageByBossLoopRpcClient

  const { data, error } = await playerDamageRpc.rpc(
    'get_player_damage_by_boss_loop',
    {
      p_guild_code: guildCode,
      p_season: season,
      p_display_name: displayName
    }
  )

  if (error) {
    logger.error(
      { guildCode, season, displayName, error },
      'Error fetching player damage by boss loop:'
    )
    return { detailedData: [] }
  }

  const rows = data ?? []

  const detailedData = rows.map((row) => ({
    loop: row.loop_index,
    bossName: row.boss_display_name,
    avgDamage: Number(row.avg_damage),
    maxDamage: Number(row.max_damage),
    totalDamage: Number(row.total_damage),
    hitCount: Number(row.hit_count),
    startTime: row.start_time,
    endTime: row.end_time,
    isPrime: row.is_prime,
    sweepCount: row.sweep_count ?? 0,
    oneShotCount: row.one_shot_count ?? 0,
    crashCount: row.crash_count ?? 0,
    effAvgDamage: row.eff_avg_damage != null ? Number(row.eff_avg_damage) : null
  }))

  return {
    detailedData: detailedData.sort((a, b) => {
      if (a.loop !== b.loop) return a.loop - b.loop
      return a.bossName.localeCompare(b.bossName)
    })
  }
}

export async function getBossDifficultyAnalysis(
  guildCode: string,
  season: string,
  rarities: string[] = ['Legendary', 'Mythic']
): Promise<BossDifficultyResult[]> {
  await assertClientSession()
  const supabase = authenticatedDbClient()

  const { data, error } = await supabase.rpc('get_boss_difficulty_analysis', {
    p_guild_code: guildCode,
    p_season: season,
    p_rarities: rarities
  })

  if (error) {
    logger.error(
      { guildCode, season, error },
      'Error fetching boss difficulty analysis:'
    )
    return []
  }

  const rows = (data || []) as BossDifficultyRow[]

  return rows.map((row) => ({
    name: row.boss_name,
    displayName: row.display_name,
    tier: row.rarity,
    set: row.set_num,
    rarity: row.rarity,
    encounterId: row.encounter_id,
    attempts: Number(row.avg_attempts),
    timeMinutes: Number(row.avg_time_minutes),
    hitCount: row.hit_count,
    totalDamage: Number(row.total_damage),
    completedLoops: row.completed_loops,
    totalLoops: row.total_loops,
    completionRate: Number(row.completion_rate),
    avgDamagePerAttempt: Number(row.avg_damage_per_attempt)
  }))
}

interface PlayerDamageByLoopForBossRow {
  loop_index: number
  display_name: string
  avg_damage: number
  max_damage: number
  total_damage: number
  hit_count: number
}

type PlayerDamageByLoopForBossRpcClient = {
  rpc(
    fn: 'get_player_damage_by_loop_for_boss',
    args: {
      p_guild_code: string
      p_season: string
      p_boss_name: string
      p_level: string
    }
  ): Promise<{ data: PlayerDamageByLoopForBossRow[] | null; error: unknown }>
}

export interface PlayerLoopDamage {
  loopIndex: number
  displayName: string
  avgDamage: number
  maxDamage: number
  totalDamage: number
  hitCount: number
}

export async function getPlayerDamageByLoopForBoss(
  guildCode: string,
  season: string,
  bossName: string,
  level: string // e.g., 'L5', 'M1'
): Promise<PlayerLoopDamage[]> {
  await assertClientSession()
  const supabase = authenticatedDbClient()
  const playerLoopRpc =
    supabase as unknown as PlayerDamageByLoopForBossRpcClient

  const { data, error } = await playerLoopRpc.rpc(
    'get_player_damage_by_loop_for_boss',
    {
      p_guild_code: guildCode,
      p_season: season,
      p_boss_name: bossName,
      p_level: level
    }
  )

  if (error) {
    logger.error(
      { guildCode, season, bossName, level, error },
      'Error fetching player damage by loop for boss:'
    )
    return []
  }

  const rows = data ?? []

  return rows.map((row) => ({
    loopIndex: row.loop_index,
    displayName: row.display_name,
    avgDamage: Number(row.avg_damage),
    maxDamage: Number(row.max_damage),
    totalDamage: Number(row.total_damage),
    hitCount: row.hit_count
  }))
}
