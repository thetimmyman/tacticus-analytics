import { createServiceClient } from '../_shared/supabase-client.ts'
import { logger } from '../_shared/logger.ts'
import {
  aggregatePerformanceRows,
  type PerformanceRow
} from './performance-core.ts'
import {
  type AssignmentConfig,
  type BossEntry,
  type GlobalThreshold,
  type HeroRequirement,
  type MetaTeam,
  type PerformanceSnapshot,
  type PlayerEntry,
  type PlayerRosterStrength,
  type PlaybookRequirement,
  DEFAULT_CONFIG,
  makeBossLookupKey,
  normalizeRarity,
  parsePreferences,
  rankNameToIndex
} from './solver-model.ts'

export const fetchBossConfig = async (guildCode: string) => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('boss_assignment_configs')
    .select('*')
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (error) {
    logger.warn('Failed to load boss assignment config', {
      guildCode,
      error: error.message
    })
    return null
  }

  return data as Partial<AssignmentConfig> | null
}

export const fetchGuildClusterCode = async (
  guildCode: string
): Promise<string | null> => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('guild_config')
    .select('cluster_code')
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (error) {
    logger.warn('Failed to load guild cluster code', {
      guildCode,
      error: error.message
    })
    return null
  }
  return data?.cluster_code ?? null
}

export const fetchRotationSnapshot = async () => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('current_guild_boss_season_rotation')
    .select('current_bosses, next_bosses, current_config_id, next_config_id')
    .eq('source', 'live')
    .maybeSingle()

  if (error) {
    logger.warn('Failed to load boss season rotation snapshot', {
      error: error.message
    })
    return null
  }

  return data
}

export const fetchBossesFromSeasonData = async (
  guildCode: string,
  season: string
) => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select('Name, rarity, set, encounterId')
    .eq('Guild', guildCode)
    .eq('Season', season)
    .eq('damageType', 'Battle')
    .gt('damageDealt', 0)
    .in('rarity', ['Legendary', 'Mythic'])

  if (error) {
    logger.warn('Failed to load boss list from season data', {
      error: error.message
    })
    return []
  }

  const seen = new Set<string>()
  const bosses: Array<Record<string, unknown>> = []

  for (const row of data ?? []) {
    if (!row?.Name) continue
    const key = `${row.Name}_${row.rarity}_${row.set}_${row.encounterId}`
    if (seen.has(key)) continue
    seen.add(key)
    bosses.push({
      boss_name: row.Name,
      rarity: row.rarity,
      set: row.set,
      encounter_id: row.encounterId
    })
  }

  return bosses
}

export const fetchLatestSeason = async (guildCode: string) => {
  const supabase = createServiceClient()
  // Canonical per-guild RPC: "Season" is TEXT, so ordering or MAX on it lex-sorts.
  const { data, error } = await supabase.rpc('get_latest_season_for_guild', {
    p_guild: guildCode
  })

  if (error) {
    logger.warn('Failed to determine latest season', {
      guildCode,
      error: error.message
    })
    return null
  }

  return data ? String(data) : null
}

export const fetchBossHp = async (guildCode: string) => {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('get_all_boss_hp', {
    p_guild_code: guildCode
  })

  if (error) {
    logger.warn('Failed to load boss HP data', {
      guildCode,
      error: error.message
    })
    return new Map<string, number>()
  }

  const map = new Map<string, number>()

  for (const row of data ?? []) {
    const name = row.boss_name
    const rarity = normalizeRarity(row.rarity)
    const setLevel = row.set_level
    const encounterId = row.encounter_id
    const maxHp = row.max_hp

    if (
      !name ||
      !rarity ||
      typeof setLevel !== 'number' ||
      typeof encounterId !== 'number'
    )
      continue
    if (typeof maxHp !== 'number' || !Number.isFinite(maxHp)) continue

    map.set(makeBossLookupKey(name, rarity, setLevel, encounterId), maxHp)
  }

  return map
}

export const fetchPlayers = async (
  guildCode: string
): Promise<PlayerEntry[]> => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('player_mapping')
    .select('player_id, display_name, boss_preferences, user_id')
    .eq('guild_code', guildCode)
    .eq('is_current', true)

  if (error) {
    logger.warn('Failed to load player roster for guild', {
      guildCode,
      error: error.message
    })
    return []
  }

  return (data ?? [])
    .filter(
      (row: { player_id: string | null; display_name: string | null }) =>
        Boolean(row.player_id) && Boolean(row.display_name)
    )
    .map(
      (row: {
        player_id: string | null
        display_name: string | null
        user_id: string | null
        boss_preferences: unknown
      }) => ({
        id: row.player_id,
        name: row.display_name,
        userId: row.user_id ?? null,
        maxTokens: DEFAULT_CONFIG.max_tokens_per_player,
        preferences: parsePreferences(row.boss_preferences),
        roster: [],
        reliability: 70
      })
    )
}

export const fetchRosterByUser = async (userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, string[]>()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('player_roster')
    .select('user_id, hero_mappings(display_name)')
    .in('user_id', userIds)

  if (error) {
    logger.warn('Failed to load player roster heroes', { error: error.message })
    return new Map<string, string[]>()
  }

  const rosterMap = new Map<string, string[]>()

  for (const row of data ?? []) {
    if (!row?.user_id) continue
    const displayName = (row as { hero_mappings?: { display_name?: string } })
      .hero_mappings?.display_name
    if (!displayName) continue

    const existing = rosterMap.get(row.user_id) ?? []
    existing.push(displayName)
    rosterMap.set(row.user_id, existing)
  }

  return rosterMap
}

export const fetchPerformanceSnapshot = async (
  guildCode: string,
  season: string,
  bosses: BossEntry[]
): Promise<PerformanceSnapshot> => {
  const supabase = createServiceClient()
  const bossNames = Array.from(
    new Set(
      bosses.flatMap((boss) => [boss.name, boss.bossType].filter(Boolean))
    )
  )

  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select(
      'Name, displayName, damageDealt, remainingHp, maxHp, encounterId, rarity, set'
    )
    .eq('Guild', guildCode)
    .eq('Season', season)
    .eq('damageType', 'Battle')
    .gt('damageDealt', 0)
    .in('Name', bossNames)

  if (error) {
    logger.warn('Failed to load performance data', {
      guildCode,
      error: error.message
    })
    return {
      playerAvg: new Map(),
      bossAvg: new Map(),
      battlesByPlayer: new Map()
    }
  }

  const performanceRows: PerformanceRow[] = []
  for (const row of data ?? []) {
    const bossName = row.Name
    const displayName = row.displayName
    const damage = row.damageDealt
    const rarity = normalizeRarity(row.rarity)
    const setLevel = row.set
    const encounterId = row.encounterId

    if (!bossName || !displayName) continue
    if (typeof damage !== 'number' || !Number.isFinite(damage)) continue
    if (typeof rarity !== 'string') continue
    if (typeof setLevel !== 'number') continue

    performanceRows.push({
      bossKey: makeBossLookupKey(bossName, rarity, setLevel, encounterId),
      displayName,
      damageDealt: damage,
      remainingHp: row.remainingHp ?? null,
      maxHp: row.maxHp ?? null
    })
  }

  // Sweep handling lives in performance-core.ts so vitest can cover it.
  return aggregatePerformanceRows(performanceRows)
}

export const fetchMetaTeams = async (
  bosses: BossEntry[],
  season: string | null,
  minAttacks: number
): Promise<Map<string, MetaTeam>> => {
  if (bosses.length === 0) return new Map()

  const supabase = createServiceClient()
  const bossTypes = Array.from(new Set(bosses.map((boss) => boss.bossType)))
  const rarities = Array.from(new Set(bosses.map((boss) => boss.rarity)))
  const sets = Array.from(new Set(bosses.map((boss) => boss.set)))
  const encounterIds = Array.from(
    new Set(bosses.map((boss) => boss.encounterId))
  )

  let query = supabase
    .from('meta_atlas_data')
    .select(
      'boss_type, sub_boss_name, encounter_index, rarity, set_num, team_composition, damage_p90, attack_count'
    )
    .in('boss_type', bossTypes)
    .in('rarity', rarities)
    .in('set_num', sets)
    .in('encounter_index', encounterIds)
    .gte('attack_count', minAttacks)

  if (season) {
    query = query.eq('season', season)
  }

  const { data, error } = await query

  if (error) {
    logger.warn('Failed to load meta atlas data', { error: error.message })
    return new Map()
  }

  const map = new Map<string, MetaTeam>()

  for (const row of data ?? []) {
    const damage =
      typeof row.damage_p90 === 'number' && Number.isFinite(row.damage_p90)
        ? row.damage_p90
        : 0
    const composition = row.team_composition

    if (!composition) continue

    const names = [row.sub_boss_name, row.boss_type].filter(Boolean) as string[]
    names.forEach((name) => {
      const key = makeBossLookupKey(
        name,
        normalizeRarity(row.rarity),
        row.set_num,
        row.encounter_index
      )
      const existing = map.get(key)
      if (!existing || damage > existing.damageP90) {
        map.set(key, { composition, damageP90: damage })
      }
    })
  }

  return map
}

export const fetchPlaybookRequirements = async (
  bossId: string,
  guildCode: string | null,
  clusterCode: string | null
): Promise<PlaybookRequirement | null> => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('boss_playbook_team_requirements')
    .select('boss_id, hero_requirements, guild_code, cluster_code')
    .eq('boss_id', bossId)
    .order('updated_at', { ascending: false })

  if (error || !data || data.length === 0) return null

  if (guildCode) {
    const guildMatch = data.find(
      (r: { guild_code: string | null; cluster_code: string | null }) =>
        r.guild_code === guildCode
    )
    if (guildMatch) {
      return {
        boss_id: guildMatch.boss_id,
        hero_requirements: guildMatch.hero_requirements as HeroRequirement[],
        tier: 'guild'
      }
    }
  }

  if (clusterCode) {
    const clusterMatch = data.find(
      (r: { guild_code: string | null; cluster_code: string | null }) =>
        r.cluster_code === clusterCode && r.guild_code == null
    )
    if (clusterMatch) {
      return {
        boss_id: clusterMatch.boss_id,
        hero_requirements: clusterMatch.hero_requirements as HeroRequirement[],
        tier: 'cluster'
      }
    }
  }

  const globalMatch = data.find(
    (r: { guild_code: string | null; cluster_code: string | null }) =>
      r.guild_code == null && r.cluster_code == null
  )
  if (globalMatch) {
    return {
      boss_id: globalMatch.boss_id,
      hero_requirements: globalMatch.hero_requirements as HeroRequirement[],
      tier: 'global'
    }
  }

  return null
}

export const fetchGlobalThresholds = async (
  rarity: string
): Promise<GlobalThreshold[]> => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('global_strength_thresholds')
    .select(
      'rarity, strength_level, min_rank_index, min_ability_active, min_ability_passive'
    )
    .eq('rarity', rarity)
    .order('min_rank_index', { ascending: true })

  if (error || !data) return []
  return data as GlobalThreshold[]
}

export const fetchPlayerRosterStrength = async (
  userIds: string[]
): Promise<Map<string, PlayerRosterStrength>> => {
  if (userIds.length === 0) return new Map()

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('player_roster')
    .select(
      'user_id, hero_mappings(display_name), rank_name, active_ability_level, passive_ability_level'
    )
    .in('user_id', userIds)

  if (error) {
    logger.warn('Failed to load player roster strength data', {
      error: error.message
    })
    return new Map()
  }

  const strengthMap = new Map<string, PlayerRosterStrength>()

  for (const row of data ?? []) {
    if (!row?.user_id) continue
    const displayName = (row as { hero_mappings?: { display_name?: string } })
      .hero_mappings?.display_name
    if (!displayName) continue

    let entry = strengthMap.get(row.user_id)
    if (!entry) {
      entry = { playerId: row.user_id, heroStrengths: new Map() }
      strengthMap.set(row.user_id, entry)
    }

    entry.heroStrengths.set(displayName.toLowerCase(), {
      rank: rankNameToIndex((row as Record<string, unknown>).rank_name),
      activeAbility:
        typeof row.active_ability_level === 'number'
          ? row.active_ability_level
          : null,
      passiveAbility:
        typeof row.passive_ability_level === 'number'
          ? row.passive_ability_level
          : null
    })
  }

  return strengthMap
}
