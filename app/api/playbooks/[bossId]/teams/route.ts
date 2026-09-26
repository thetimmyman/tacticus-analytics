import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import {
  checkFeatureAccess,
  getUserAccessLevels
} from '@/app/lib/services/feature-release-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.playbooks.bossId.teams')
import playbooks from '@/data/boss-playbooks/playbooks.json'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { appCache } from '@tacticus/app-core/app-cache'

// Battle data is cron-synced, so 5 min staleness is fine. Auth still runs on every request.
const PLAYBOOKS_TEAMS_TTL_SECONDS = 5 * 60

type Boss = {
  id: string
  name: string
  tacticusTableIds?: {
    boss?: string
    prime1?: string
    prime2?: string
  }
}

const MIN_ATTACKS = 20
const MAIN_ENCOUNTER_FILTER = 'encounter_index.is.null,encounter_index.eq.0'
const MAX_TEAMS_PER_RARITY = 3
const QUERY_LIMIT_PER_RARITY = MAX_TEAMS_PER_RARITY * 10
const DEFAULT_RARITY_SETS = ['M1', 'L5']

const RARITY_PREFIX_BY_NAME: Record<string, string> = {
  Legendary: 'L',
  Mythic: 'M'
}

const resolveBossEntry = (bossId: string): Boss | null => {
  return (
    (playbooks.bosses as Boss[]).find((entry) => entry.id === bossId) || null
  )
}

const BOSS_TYPE_STOPWORDS = new Set(['of', 'the', 'and', 'a', 'an'])

const BOSS_NAME_ALIASES: Record<string, string[]> = {
  'magnus the red': ['magnus', 'thousand sons'],
  mortarion: ['mortarion', 'death guard'],
  'the silent king': ['silent king', 'szarekh', 'necrons'],
  ghazghkull: ['ghazghkull', 'ghaz', 'thraka', 'ork'],
  'avatar of khaine': ['avatar', 'khaine', 'aeldari'],
  abaddon: ['abaddon', 'despoiler', 'warmaster'],
  swarmlord: ['swarmlord', 'tyranid', 'hive'],
  shadowsun: ['shadowsun', 'tau', "t'au"],
  'ragnar blackmane': ['ragnar', 'blackmane', 'space wolf'],
  guilliman: ['guilliman', 'roboute', 'ultramarine'],
  'hive tyrant': ['hive tyrant', 'tyranid'],
  typhus: ['typhus', 'herald', 'plague']
}

const normalizeBossName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9\s']/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const getBossNameVariants = (bossName: string): string[] => {
  const normalized = normalizeBossName(bossName)
  const variants = new Set<string>([bossName, normalized])

  const aliasKey = Object.keys(BOSS_NAME_ALIASES).find(
    (key) =>
      normalizeBossName(key) === normalized ||
      normalized.includes(normalizeBossName(key))
  )
  if (aliasKey) {
    const aliases = BOSS_NAME_ALIASES[aliasKey]
    if (aliases) {
      aliases.forEach((alias) => variants.add(alias))
    }
  }

  const tokens = normalized
    .split(/\s+/)
    .filter((t) => !BOSS_TYPE_STOPWORDS.has(t) && t.length > 2)
  tokens.forEach((t) => variants.add(t))

  const firstToken = tokens[0]
  if (firstToken) {
    variants.add(firstToken)
  }

  return Array.from(variants)
}

const buildBossTypePattern = (bossName: string) => {
  const tokens = bossName
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean)
  const filtered = tokens.filter(
    (token) => !BOSS_TYPE_STOPWORDS.has(token.toLowerCase())
  )
  const selected = filtered.length > 0 ? filtered : tokens
  return selected.length > 0 ? `%${selected.join('%')}%` : `%${bossName}%`
}

const buildBossTypePatterns = (bossName: string): string[] => {
  const variants = getBossNameVariants(bossName)
  const patterns = new Set<string>()

  variants.forEach((variant) => {
    patterns.add(buildBossTypePattern(variant))
    const normalized = normalizeBossName(variant)
    if (normalized.length > 2) {
      patterns.add(`%${normalized}%`)
    }
  })

  return Array.from(patterns)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applySeasonFilter = (query: any, season: string | null) =>
  season ? query.eq('season', season) : query

const resolveBossTypeByUnitId = async (
  supabase: TypedSupabaseClient,
  bossUnitId: string,
  season: string | null
): Promise<string | null> => {
  if (season) {
    const { data: seasonalMatch } = await supabase
      .from('meta_atlas_data')
      .select('boss_type')
      .eq('boss_unit_id', bossUnitId)
      .or(MAIN_ENCOUNTER_FILTER)
      .eq('season', season)
      .limit(1)
      .maybeSingle()

    if (seasonalMatch?.boss_type) {
      return seasonalMatch.boss_type
    }
  }

  const { data: anyMatch } = await supabase
    .from('meta_atlas_data')
    .select('boss_type')
    .eq('boss_unit_id', bossUnitId)
    .or(MAIN_ENCOUNTER_FILTER)
    .limit(1)
    .maybeSingle()

  return anyMatch?.boss_type ?? null
}

const resolveBossType = async (
  supabase: TypedSupabaseClient,
  bossName: string,
  season: string | null,
  bossUnitId?: string | null
) => {
  if (bossUnitId) {
    const unitIdMatch = await resolveBossTypeByUnitId(
      supabase,
      bossUnitId,
      season
    )
    if (unitIdMatch) {
      logger.debug(
        { bossUnitId, bossType: unitIdMatch },
        'Boss type resolved via unit ID'
      )
      return unitIdMatch
    }
  }

  const normalizedBossName = normalizeBossName(bossName)
  const { data: mappingData } = await supabase
    .from('boss_mapping')
    .select('boss_type, boss_name')
    .eq('encounter_index', 0)

  let mappedType = ''
  if (mappingData && mappingData.length > 0) {
    const exactMatch = mappingData.find(
      (row) => normalizeBossName(row.boss_name) === normalizedBossName
    )
    if (exactMatch) {
      mappedType = exactMatch.boss_type?.trim() ?? ''
    } else {
      const partialMatch = mappingData.find(
        (row) =>
          normalizedBossName.includes(normalizeBossName(row.boss_name)) ||
          normalizeBossName(row.boss_name).includes(normalizedBossName)
      )
      if (partialMatch) {
        mappedType = partialMatch.boss_type?.trim() ?? ''
      }
    }
  }

  const patterns = buildBossTypePatterns(bossName)

  const findBossTypeMatch = async (
    bossType: string,
    seasonFilter: string | null
  ) => {
    let query = supabase
      .from('meta_atlas_data')
      .select('boss_type')
      .eq('boss_type', bossType)
      .or(MAIN_ENCOUNTER_FILTER)
      .limit(1)
    query = applySeasonFilter(query, seasonFilter)
    const { data: match } = await query.maybeSingle()
    return match?.boss_type ?? null
  }

  const findBossTypeByPatterns = async (seasonFilter: string | null) => {
    for (const pattern of patterns) {
      let query = supabase
        .from('meta_atlas_data')
        .select('boss_type, attack_count')
        .or(MAIN_ENCOUNTER_FILTER)
        .ilike('boss_type', pattern)
        .order('attack_count', { ascending: false })
        .limit(1)
      query = applySeasonFilter(query, seasonFilter)
      const { data: match } = await query.maybeSingle()
      if (match?.boss_type) {
        logger.debug(
          { pattern, bossType: match.boss_type },
          'Boss type matched via pattern'
        )
        return match.boss_type
      }
    }
    return null
  }

  if (mappedType) {
    const seasonalMatch = await findBossTypeMatch(mappedType, season)
    if (seasonalMatch) {
      logger.debug(
        { bossName, mappedType },
        'Boss type resolved via mapping (seasonal)'
      )
      return mappedType
    }
  }

  const seasonalFallback = await findBossTypeByPatterns(season)
  if (seasonalFallback) {
    return seasonalFallback
  }

  if (season) {
    if (mappedType) {
      const anyMatch = await findBossTypeMatch(mappedType, null)
      if (anyMatch) {
        logger.debug(
          { bossName, mappedType },
          'Boss type resolved via mapping (any season)'
        )
        return mappedType
      }
    }
    const anyFallback = await findBossTypeByPatterns(null)
    if (anyFallback) {
      return anyFallback
    }
  }

  logger.warn(
    { bossName, mappedType },
    'Boss type resolution fell through to default'
  )
  return mappedType || bossName
}

const toStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

const mapTeamRow = (row: Record<string, unknown>) => ({
  team_hash: toStringValue(row.team_hash ?? row.team_id ?? row.id),
  team_composition: toStringValue(
    row.team_composition ?? row.composition ?? row.team
  ),
  meta_team: toStringValue(row.meta_team ?? row.team_name),
  meta_team_id: row.meta_team_id ?? null,
  rarity_set: toStringValue(row.rarity_set),
  damage_p50: row.damage_p50 ?? row.damage_avg ?? null,
  damage_p90: row.damage_p90 ?? null,
  damage_p75: row.damage_p75 ?? null,
  damage_avg: row.damage_avg ?? null,
  attack_count: row.attack_count ?? row.sample_size ?? null,
  boss_type: toStringValue(row.boss_type ?? row.boss_name),
  encounter_index: row.encounter_index ?? null,
  season: toStringValue(row.season)
})

const rankRaritySet = (value: string) => {
  const match = value.match(/^([LM])(\d+)$/i)
  if (!match) return -1
  const prefix = match[1] ?? ''
  if (!prefix) return -1
  const normalizedPrefix = prefix.toUpperCase()
  const setNumber = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isFinite(setNumber)) return -1
  const base = normalizedPrefix === 'M' ? 100 : 0
  return base + setNumber
}

const resolveRaritySet = (
  rarity: string | null | undefined,
  setValue: number | string | null | undefined
) => {
  if (!rarity) return null
  const prefix = RARITY_PREFIX_BY_NAME[rarity] ?? null
  if (!prefix) return null
  const setNumber =
    typeof setValue === 'number'
      ? setValue
      : Number.parseInt(setValue ?? '', 10)
  if (!Number.isFinite(setNumber)) return null
  return `${prefix}${setNumber + 1}`
}

const resolveGuildRaritySets = async (
  supabase: TypedSupabaseClient,
  guildCode: string | null
) => {
  if (!guildCode) return []
  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select('rarity, set')
    .eq('Guild', guildCode)
    .eq('damageType', 'Battle')
    .gt('damageDealt', 0)
    .in('rarity', ['Legendary', 'Mythic'])
    .not('rarity', 'is', null)
    .not('set', 'is', null)
    .order('startedOn', { ascending: false })

  if (error) {
    logger.warn({ error, guildCode }, 'Failed to resolve guild rarity history')
    return []
  }

  const unique = new Map<string, number>()
  for (const row of data as Array<{
    rarity?: string | null
    set?: number | null
  }>) {
    const raritySet = resolveRaritySet(row.rarity ?? null, row.set ?? null)
    if (!raritySet) continue
    unique.set(raritySet, rankRaritySet(raritySet))
  }

  return Array.from(unique.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([raritySet]) => raritySet)
}

const resolveAllRaritySets = async (
  supabase: TypedSupabaseClient
): Promise<string[]> => {
  const { data, error } = await supabase.rpc(
    'get_meta_atlas_distinct_rarity_sets'
  )
  if (!error && Array.isArray(data)) {
    const sorted = data
      .map((row: { rarity_set?: string | null }) => row.rarity_set ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => rankRaritySet(b) - rankRaritySet(a))
    if (sorted.length > 0) {
      return sorted
    }
  }
  return DEFAULT_RARITY_SETS
}

const resolveBossRaritySets = async (
  supabase: TypedSupabaseClient,
  bossType: string
): Promise<string[]> => {
  const { data, error } = await supabase
    .from('meta_atlas_data')
    .select('rarity_set')
    .eq('boss_type', bossType)
    .or(MAIN_ENCOUNTER_FILTER)
    .gte('attack_count', MIN_ATTACKS)
    .not('meta_team', 'is', null)

  if (error || !data || data.length === 0) {
    return []
  }

  const unique = new Set<string>()
  for (const row of data) {
    if (row.rarity_set) {
      unique.add(row.rarity_set)
    }
  }

  return Array.from(unique).sort((a, b) => rankRaritySet(b) - rankRaritySet(a))
}

const dedupeTeams = (rows: Record<string, unknown>[]) => {
  const mapped = rows.map((row) => mapTeamRow(row))
  const unique = new Map<string, ReturnType<typeof mapTeamRow>>()
  mapped.forEach((team, index) => {
    const baseKey = team.team_hash || team.team_composition || team.meta_team
    const key = baseKey
      ? `${baseKey}-${team.rarity_set ?? ''}-${team.encounter_index ?? ''}-${team.season ?? ''}`
      : `row-${index}`
    if (!unique.has(key)) {
      unique.set(key, team)
    }
  })
  return Array.from(unique.values())
}

const normalizeMetaTeam = (value: string | null | undefined) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const selectOptimalMetaTeams = (
  teams: ReturnType<typeof mapTeamRow>[],
  limit = MAX_TEAMS_PER_RARITY
) => {
  const byMetaTeam = new Map<string, ReturnType<typeof mapTeamRow>>()
  const scoreFor = (team: ReturnType<typeof mapTeamRow>) =>
    Number(team.damage_p90 ?? team.damage_p75 ?? team.damage_avg ?? 0)

  teams.forEach((team) => {
    const metaTeam = normalizeMetaTeam(team.meta_team)
    if (!metaTeam || !team.team_composition) return
    const key = metaTeam.toLowerCase()
    const existing = byMetaTeam.get(key)
    if (!existing || scoreFor(team) > scoreFor(existing)) {
      byMetaTeam.set(key, { ...team, meta_team: metaTeam })
    }
  })

  return Array.from(byMetaTeam.values())
    .sort((a, b) => {
      const scoreDiff = scoreFor(b) - scoreFor(a)
      if (scoreDiff !== 0) return scoreDiff
      return (a.meta_team || '').localeCompare(b.meta_team || '')
    })
    .slice(0, limit)
}

const resolveCurrentSeason = async (supabase: TypedSupabaseClient) => {
  const { data, error } = await supabase
    .from('meta_atlas_data')
    .select('season')
    .order('season', { ascending: false })
    .limit(50)

  if (error || !data || data.length === 0) {
    return null
  }

  const parsed = data
    .map((row) => ({
      raw: row.season,
      value: Number.parseInt(row.season ?? '', 10)
    }))
    .filter((entry) => Number.isFinite(entry.value))

  if (parsed.length === 0) {
    const firstRow = data[0]
    return firstRow?.season ?? null
  }

  return parsed.reduce((max, entry) => (entry.value > max.value ? entry : max))
    .raw
}

const fetchTeamsForRarity = async (
  supabase: TypedSupabaseClient,
  bossType: string,
  raritySet: string
) => {
  const { data: teamData, error: teamError } = await supabase
    .from('meta_atlas_data')
    .select(
      'team_hash, team_composition, meta_team, rarity_set, boss_type, encounter_index, damage_p90, damage_p75, damage_avg, attack_count, season'
    )
    .eq('boss_type', bossType)
    .or(MAIN_ENCOUNTER_FILTER)
    .eq('rarity_set', raritySet)
    .gte('attack_count', MIN_ATTACKS)
    .not('meta_team', 'is', null)
    .order('damage_p90', { ascending: false })
    .limit(QUERY_LIMIT_PER_RARITY)

  if (teamError) {
    logger.error({ error: teamError, raritySet }, 'Playbook teams query failed')
    return []
  }

  return selectOptimalMetaTeams(dedupeTeams(teamData || []))
}

export const GET = withErrorHandler(
  async (
    request: Request,
    { params }: { params: Promise<{ bossId: string }> }
  ) => {
    try {
      const { user } = await requireAuthForApi()
      const { bossId } = await params
      const access = await checkFeatureAccess(user.id, 'boss_playbooks')

      if (!access.has_access) {
        throw Errors.fromResponse(403, {
          error: 'Boss Playbooks requires alpha access',
          stage: access.stage,
          reason: access.reason
        })
      }

      const url = new URL(request.url)
      const raritySetsParam = url.searchParams.get('rarity_sets')

      // The payload depends on guild_code, so the cache key is guild-scoped.
      const accessLevels = await getUserAccessLevels(user.id)
      const cacheKey = `playbooks_teams:v1:${bossId}:${accessLevels.guild_code ?? '__noguild__'}:${raritySetsParam ?? ''}`
      const cached = await appCache.get<Record<string, unknown>>(cacheKey)
      if (cached !== null && cached !== undefined) {
        return NextResponse.json(cached)
      }

      const supabase = serviceDb()
      const bossEntry = resolveBossEntry(bossId)
      const bossName = bossEntry?.name || bossId
      const bossUnitId = bossEntry?.tacticusTableIds?.boss || null
      const currentSeason = await resolveCurrentSeason(supabase)
      const bossType = await resolveBossType(
        supabase,
        bossName,
        currentSeason,
        bossUnitId
      )

      const allRaritySets = await resolveAllRaritySets(supabase)

      const bossRaritySets = bossType
        ? await resolveBossRaritySets(supabase, bossType)
        : []

      const guildRaritySets = await resolveGuildRaritySets(
        supabase,
        accessLevels.guild_code
      )

      // Prefer rarity sets with data for this boss, then guild, then global.
      let defaultRaritySets: string[]
      if (bossRaritySets.length > 0) {
        const guildSet = new Set(guildRaritySets)
        const sorted = [...bossRaritySets].sort((a, b) => {
          const aInGuild = guildSet.has(a) ? 1 : 0
          const bInGuild = guildSet.has(b) ? 1 : 0
          if (aInGuild !== bInGuild) return bInGuild - aInGuild
          return rankRaritySet(b) - rankRaritySet(a)
        })
        defaultRaritySets = sorted.slice(0, 2)
      } else if (guildRaritySets.length > 0) {
        defaultRaritySets = guildRaritySets.slice(0, 2)
      } else {
        defaultRaritySets = allRaritySets.slice(0, 2)
      }

      const raritySets = raritySetsParam
        ? raritySetsParam.split(',').filter((rs) => allRaritySets.includes(rs))
        : defaultRaritySets

      const emptyRarityTeams = raritySets.map((rarity) => ({
        rarity_set: rarity,
        teams: []
      }))

      if (!bossType) {
        const emptyBossResponse = {
          rarity_teams: emptyRarityTeams,
          available_rarity_sets:
            bossRaritySets.length > 0 ? bossRaritySets : allRaritySets,
          default_rarity_sets: defaultRaritySets
        }
        await appCache.set(
          cacheKey,
          emptyBossResponse,
          PLAYBOOKS_TEAMS_TTL_SECONDS
        )
        return NextResponse.json(emptyBossResponse)
      }

      const rarityTeams = await Promise.all(
        raritySets.map(async (rarity) => ({
          rarity_set: rarity,
          teams: await fetchTeamsForRarity(supabase, bossType, rarity)
        }))
      )

      const fullPlaybookResponse = {
        rarity_teams: rarityTeams,
        available_rarity_sets: allRaritySets,
        default_rarity_sets: defaultRaritySets
      }
      await appCache.set(
        cacheKey,
        fullPlaybookResponse,
        PLAYBOOKS_TEAMS_TTL_SECONDS
      )
      return NextResponse.json(fullPlaybookResponse)
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      logger.error({ error }, 'Playbook teams API error')
      throw Errors.fromResponse(500, { error: 'Failed to fetch raid teams' })
    }
  }
)
