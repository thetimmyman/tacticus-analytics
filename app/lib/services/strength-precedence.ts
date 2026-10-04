import type { SupabaseClient } from '@supabase/supabase-js'
import type { HeroRequirement } from '@/app/lib/meta/roster-strength'
import { apiCache } from '@tacticus/app-core/unified-cache'

export type StrengthTier = 'guild' | 'cluster' | 'global'

const PLAYBOOK_CACHE_TTL = 5 * 60 * 1000
const GLOBAL_THRESHOLD_CACHE_TTL = 30 * 60 * 1000

function makePlaybookCacheKey(
  bossId: string,
  metaTeamId: string | null,
  guildCode: string | null,
  clusterCode: string | null
): string {
  return `strength:playbook:${bossId}:${metaTeamId ?? 'null'}:${guildCode ?? 'null'}:${clusterCode ?? 'null'}`
}

function makeGlobalThresholdCacheKey(rarity: string): string {
  return `strength:global:${rarity.toLowerCase()}`
}

export type PlaybookRequirement = {
  boss_id: string
  meta_team_id: string | null
  team_name: string | null
  hero_requirements: HeroRequirement[]
  guild_code: string | null
  cluster_code: string | null
  tier: StrengthTier
}

export type GlobalThreshold = {
  rarity: string
  strength_level: string
  min_rank: string
  min_rank_index: number
  min_ability_active: number | null
  min_ability_passive: number | null
}

export type StrengthLookupResult = {
  source: 'playbook' | 'global' | 'none'
  tier: StrengthTier | null
  requirements: PlaybookRequirement | null
  globalThresholds: GlobalThreshold[] | null
}

async function fetchPlaybookRequirementsFromDb(
  supabase: SupabaseClient,
  bossId: string,
  metaTeamId: string | null,
  guildCode: string | null,
  clusterCode: string | null
): Promise<PlaybookRequirement | null> {
  const query = supabase
    .from('boss_playbook_team_requirements')
    .select(
      'boss_id, meta_team_id, team_name, hero_requirements, guild_code, cluster_code'
    )
    .eq('boss_id', bossId)

  if (metaTeamId) {
    query.eq('meta_team_id', metaTeamId)
  }

  const { data, error } = await query.order('updated_at', { ascending: false })

  if (error || !data || data.length === 0) return null

  if (guildCode) {
    const guildMatch = data.find((r) => r.guild_code === guildCode)
    if (guildMatch) {
      return {
        ...guildMatch,
        hero_requirements: guildMatch.hero_requirements as HeroRequirement[],
        tier: 'guild'
      }
    }
  }

  if (clusterCode) {
    const clusterMatch = data.find(
      (r) => r.cluster_code === clusterCode && r.guild_code == null
    )
    if (clusterMatch) {
      return {
        ...clusterMatch,
        hero_requirements: clusterMatch.hero_requirements as HeroRequirement[],
        tier: 'cluster'
      }
    }
  }

  const globalMatch = data.find(
    (r) => r.guild_code == null && r.cluster_code == null
  )
  if (globalMatch) {
    return {
      ...globalMatch,
      hero_requirements: globalMatch.hero_requirements as HeroRequirement[],
      tier: 'global'
    }
  }

  return null
}

export async function fetchPlaybookRequirements(
  supabase: SupabaseClient,
  bossId: string,
  metaTeamId: string | null,
  guildCode: string | null,
  clusterCode: string | null
): Promise<PlaybookRequirement | null> {
  const cacheKey = makePlaybookCacheKey(
    bossId,
    metaTeamId,
    guildCode,
    clusterCode
  )

  const result = (await apiCache.getOrFetch(
    cacheKey,
    () =>
      fetchPlaybookRequirementsFromDb(
        supabase,
        bossId,
        metaTeamId,
        guildCode,
        clusterCode
      ),
    { ttl: PLAYBOOK_CACHE_TTL, tags: ['strength', 'playbook'] }
  )) as PlaybookRequirement | null

  return result as PlaybookRequirement | null
}

async function fetchGlobalThresholdsFromDb(
  supabase: SupabaseClient,
  rarity: string
): Promise<GlobalThreshold[]> {
  const { data, error } = await supabase
    .from('global_strength_thresholds')
    .select(
      'rarity, strength_level, min_rank, min_rank_index, min_ability_active, min_ability_passive'
    )
    .eq('rarity', rarity)
    .order('min_rank_index', { ascending: true })

  if (error || !data) return []
  return data as GlobalThreshold[]
}

export async function fetchGlobalThresholds(
  supabase: SupabaseClient,
  rarity: string
): Promise<GlobalThreshold[]> {
  const cacheKey = makeGlobalThresholdCacheKey(rarity)

  const result = await apiCache.getOrFetch(
    cacheKey,
    () => fetchGlobalThresholdsFromDb(supabase, rarity),
    { ttl: GLOBAL_THRESHOLD_CACHE_TTL, tags: ['strength', 'global-threshold'] }
  )

  return result as GlobalThreshold[]
}

export function evaluateHeroAgainstThreshold(
  heroRank: number | null,
  heroActiveAbility: number | null,
  heroPassiveAbility: number | null,
  threshold: GlobalThreshold
): boolean {
  if (heroRank == null) return false
  if (heroRank < threshold.min_rank_index) return false

  if (threshold.min_ability_active != null) {
    if (
      heroActiveAbility == null ||
      heroActiveAbility < threshold.min_ability_active
    ) {
      return false
    }
  }

  if (threshold.min_ability_passive != null) {
    if (
      heroPassiveAbility == null ||
      heroPassiveAbility < threshold.min_ability_passive
    ) {
      return false
    }
  }

  return true
}

export function evaluateHeroAgainstPlaybook(
  heroRank: number | null,
  heroActiveAbility: number | null,
  heroPassiveAbility: number | null,
  requirement: HeroRequirement
): { passes: boolean; reason?: string } {
  const minRankIndex = requirement.min_rank_index

  if (minRankIndex != null) {
    if (heroRank == null) return { passes: false, reason: 'Missing rank data' }
    if (heroRank < minRankIndex)
      return {
        passes: false,
        reason: `Rank too low (need ${requirement.min_rank})`
      }
  }

  if (requirement.min_ability_active != null) {
    if (heroActiveAbility == null)
      return { passes: false, reason: 'Missing active ability data' }
    if (heroActiveAbility < requirement.min_ability_active) {
      return {
        passes: false,
        reason: `Active ability too low (need ${requirement.min_ability_active})`
      }
    }
  }

  if (requirement.min_ability_passive != null) {
    if (heroPassiveAbility == null)
      return { passes: false, reason: 'Missing passive ability data' }
    if (heroPassiveAbility < requirement.min_ability_passive) {
      return {
        passes: false,
        reason: `Passive ability too low (need ${requirement.min_ability_passive})`
      }
    }
  }

  return { passes: true }
}

export type RosterStrengthScore = {
  score: number
  maxScore: number
  percentage: number
  passing: number
  failing: number
  missing: number
  details: Array<{
    heroName: string
    passes: boolean
    reason?: string
  }>
}

export function scoreRosterAgainstPlaybook(
  roster: Map<
    string,
    {
      rank: number | null
      activeAbility: number | null
      passiveAbility: number | null
    }
  >,
  requirements: HeroRequirement[]
): RosterStrengthScore {
  const details: RosterStrengthScore['details'] = []
  let passing = 0
  let failing = 0
  let missing = 0

  for (const req of requirements) {
    const heroName = req.hero_name
    const heroData = roster.get(heroName.toLowerCase())

    if (!heroData) {
      missing++
      details.push({ heroName, passes: false, reason: 'Hero not in roster' })
      continue
    }

    const result = evaluateHeroAgainstPlaybook(
      heroData.rank,
      heroData.activeAbility,
      heroData.passiveAbility,
      req
    )

    if (result.passes) {
      passing++
    } else {
      failing++
    }

    details.push({ heroName, passes: result.passes, reason: result.reason })
  }

  const total = requirements.length
  const score = passing
  const maxScore = total
  const percentage = total > 0 ? Math.round((passing / total) * 100) : 0

  return { score, maxScore, percentage, passing, failing, missing, details }
}
