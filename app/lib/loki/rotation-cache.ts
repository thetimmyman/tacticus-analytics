import 'server-only'
import { serviceDb } from '@/app/lib/db'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.loki.rotation-cache')
import {
  getSeasonConfigById,
  getSeasonConfigIdForOffset,
  canonicalizeBossId,
  prettyBossName,
  type SeasonBoss
} from '@/app/lib/loki/season-configs'
import type {
  CurrentGuildBossSeasonRotation,
  GuildBossSeasonRotation,
  GuildBossSeasonRotationInsert
} from '@tacticus/app-core/types'
import { getLatestSeason } from '@/app/lib/utils/season'

const SOURCE = 'live'

export interface SeasonRotationSnapshot {
  id?: string
  resolvedAt: string
  seasonNumber: number | null
  source: string
  currentConfigId: string
  nextConfigId: string
  currentBosses: SeasonBoss[]
  nextBosses: SeasonBoss[]
  matches: number
  observedBosses: string[]
  notes: string | null
  errorReason: string | null
}

interface ComputedRotation {
  seasonNumber: number | null
  currentConfigId: string
  nextConfigId: string
  currentBosses: SeasonBoss[]
  nextBosses: SeasonBoss[]
}

const bossSignature = (bosses: SeasonBoss[]) =>
  bosses
    .map(
      (boss) =>
        `${boss.canonical}:${boss.rarity}:${boss.set}:${boss.encounter_id}:${boss.variant ?? ''}`
    )
    .join('|')

const toBossArray = (value: unknown): SeasonBoss[] => {
  if (Array.isArray(value)) {
    return value as SeasonBoss[]
  }
  return []
}

const toObservedArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

const mapRowToSnapshot = (
  row: GuildBossSeasonRotation | CurrentGuildBossSeasonRotation
): SeasonRotationSnapshot => ({
  id: row.id ?? undefined,
  resolvedAt: row.resolved_at ?? new Date().toISOString(),
  seasonNumber: row.season_number ?? null,
  source: row.source ?? SOURCE,
  currentConfigId: row.current_config_id ?? '',
  nextConfigId: row.next_config_id ?? '',
  currentBosses: toBossArray(row.current_bosses),
  nextBosses: toBossArray(row.next_bosses),
  matches: row.matches ?? 0,
  observedBosses: toObservedArray(row.observed_bosses),
  notes: row.notes ?? null,
  errorReason: row.error_reason ?? null
})

const computeRotationFromLiveData = async (): Promise<ComputedRotation> => {
  try {
    const supabase = serviceDb()
    const latestSeason = await getLatestSeason()
    if (latestSeason === null) {
      // Throw rather than query .eq('Season', null) and compute a bogus rotation.
      throw new Error('season data unavailable: cannot compute live rotation')
    }
    const seasonNumber = parseInt(latestSeason, 10) || null

    const { data: bossData, error } = await supabase
      .from('EOT_GR_data')
      .select('Name, rarity, set, encounterId')
      .eq('Season', latestSeason)
      .in('encounterId', [0, 1, 2])
      .in('rarity', ['Legendary', 'Mythic'])
      .not('Name', 'is', null)
      .order('startedOn', { ascending: false })

    if (error) {
      logger.error({ error: error.message }, 'Failed to fetch live boss data')
      throw new Error('Failed to fetch live boss data: ' + error.message)
    }

    const uniqueBosses = new Map<
      string,
      { Name: string; rarity: string; set: number; encounterId: number }
    >()
    bossData?.forEach((row) => {
      if (!row.Name || !row.rarity || row.set === null) return
      const key = `${row.rarity}_${row.set}_${row.encounterId}`
      if (!uniqueBosses.has(key)) {
        uniqueBosses.set(key, {
          Name: row.Name as string,
          rarity: row.rarity as string,
          set: row.set as number,
          encounterId: row.encounterId
        })
      }
    })

    const currentBosses: SeasonBoss[] = Array.from(uniqueBosses.values()).map(
      (row) => {
        const bossType = row.Name.replace(/\s+/g, '')
        const canonical = canonicalizeBossId(bossType)
        return {
          boss_type: bossType,
          boss_name: prettyBossName(bossType),
          set: row.set,
          encounter_id: row.encounterId,
          rarity: row.rarity,
          canonical,
          variant: null
        }
      }
    )

    currentBosses.sort((a, b) => {
      const rarityOrder = { Mythic: 0, Legendary: 1 }
      const aRarity = rarityOrder[a.rarity as keyof typeof rarityOrder] ?? 1
      const bRarity = rarityOrder[b.rarity as keyof typeof rarityOrder] ?? 1
      if (aRarity !== bRarity) return aRarity - bRarity
      if (a.set !== b.set) return a.set - b.set
      return a.encounter_id - b.encounter_id
    })

    const nextConfigId = getSeasonConfigIdForOffset(1)
    const nextConfig = getSeasonConfigById(nextConfigId.id)
    const nextBosses = nextConfig.bosses

    return {
      seasonNumber,
      currentConfigId: `live_season_${latestSeason}`,
      nextConfigId: nextConfigId.id,
      currentBosses,
      nextBosses
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to compute rotation from live data')
    throw error
  }
}

export const fetchLatestRotationSnapshot =
  async (): Promise<SeasonRotationSnapshot | null> => {
    try {
      const supabase = serviceDb()
      const { data, error } = await supabase
        .from('current_guild_boss_season_rotation')
        .select('*')
        .eq('source', SOURCE)
        .maybeSingle()

      if (error) {
        logger.warn(
          { error: error },
          'Unable to fetch cached guild boss rotation'
        )
        return null
      }

      if (!data) {
        return null
      }

      return mapRowToSnapshot(data as unknown as CurrentGuildBossSeasonRotation)
    } catch (error) {
      logger.warn(
        { error: error },
        'Unexpected error while fetching cached guild boss rotation'
      )
      return null
    }
  }

const insertRotationSnapshot = async (
  payload: GuildBossSeasonRotationInsert
): Promise<SeasonRotationSnapshot | null> => {
  try {
    const supabase = serviceDb()
    const { data, error } = await supabase
      .from('guild_boss_season_rotation')
      .insert([payload] as never)
      .select('*')
      .single()

    if (error || !data) {
      if (error) {
        logger.error(
          { err: error },
          'Failed to insert guild boss rotation snapshot'
        )
      }
      return null
    }

    return mapRowToSnapshot(data as unknown as GuildBossSeasonRotation)
  } catch (error) {
    logger.error(
      { err: error },
      'Unexpected error while inserting guild boss rotation snapshot'
    )
    return null
  }
}

export const refreshRotationSnapshot = async (options?: {
  reference?: Date | number
  existing?: SeasonRotationSnapshot | null
  force?: boolean
}): Promise<SeasonRotationSnapshot | null> => {
  const computed = await computeRotationFromLiveData()

  if (
    !options?.force &&
    options?.existing &&
    options.existing.currentConfigId === computed.currentConfigId &&
    options.existing.nextConfigId === computed.nextConfigId &&
    bossSignature(options.existing.currentBosses) ===
      bossSignature(computed.currentBosses) &&
    bossSignature(options.existing.nextBosses) ===
      bossSignature(computed.nextBosses)
  ) {
    return options.existing
  }

  return insertRotationSnapshot({
    season_number: computed.seasonNumber,
    source: SOURCE,
    current_config_id: computed.currentConfigId,
    current_bosses:
      computed.currentBosses as unknown as GuildBossSeasonRotationInsert['current_bosses'],
    next_config_id: computed.nextConfigId,
    next_bosses:
      computed.nextBosses as unknown as GuildBossSeasonRotationInsert['next_bosses'],
    matches: computed.currentBosses.length,
    observed_bosses: [],
    notes: 'Auto-resolved from live battle data',
    error_reason: null
  })
}

export const ensureRotationSnapshot =
  async (): Promise<SeasonRotationSnapshot | null> => {
    const existing = await fetchLatestRotationSnapshot()

    const computed = await computeRotationFromLiveData()

    const configMatches =
      existing &&
      existing.currentConfigId === computed.currentConfigId &&
      existing.nextConfigId === computed.nextConfigId

    const bossMatches =
      existing &&
      bossSignature(existing.currentBosses) ===
        bossSignature(computed.currentBosses) &&
      bossSignature(existing.nextBosses) === bossSignature(computed.nextBosses)

    if (configMatches && bossMatches) {
      return existing
    }

    if (existing && configMatches && !bossMatches) {
      logger.warn(
        {
          existingCurrentCount: existing.currentBosses.length,
          computedCurrentCount: computed.currentBosses.length,
          existingNextCount: existing.nextBosses.length,
          computedNextCount: computed.nextBosses.length
        },
        'Rotation snapshot has mismatched boss data, refreshing'
      )
    }

    return refreshRotationSnapshot({ existing, force: true })
  }

export const computeFutureConfigBosses = (
  offset: number,
  reference?: Date | number
): SeasonBoss[] => {
  const { id } = getSeasonConfigIdForOffset(offset, reference)
  return getSeasonConfigById(id).bosses
}

export interface RotationVerificationResult {
  aligned: boolean
  configBoss: string | null
  liveBoss: string | null
  level: string
  suggestedOffset?: number
}

export const verifyRotationAgainstLiveData =
  async (): Promise<RotationVerificationResult> => {
    const supabase = serviceDb()
    const computed = await computeRotationFromLiveData()

    const l2ConfigBoss = computed.currentBosses.find(
      (b) => b.rarity === 'Legendary' && b.set === 1 && b.encounter_id === 0
    )

    const { data: liveData, error } = await supabase
      .from('EOT_GR_data')
      .select('Name')
      .eq('encounterId', 0)
      .eq('rarity', 'Legendary')
      .eq('set', 1)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn(
        { error: error.message },
        'Failed to fetch live L2 boss data for rotation verification'
      )
      return {
        aligned: true,
        configBoss: l2ConfigBoss?.boss_name ?? null,
        liveBoss: null,
        level: 'L2'
      }
    }

    const liveBoss = liveData?.Name ?? null
    const configBoss = l2ConfigBoss?.boss_name ?? null

    if (!liveBoss || !configBoss) {
      return { aligned: true, configBoss, liveBoss, level: 'L2' }
    }

    const configCanonical = canonicalizeBossId(configBoss)
    const liveCanonical = canonicalizeBossId(liveBoss)
    const aligned = configCanonical === liveCanonical

    if (!aligned) {
      logger.warn(
        {
          configBoss,
          liveBoss,
          currentConfigId: computed.currentConfigId,
          configCanonical,
          liveCanonical
        },
        'Rotation config misaligned with live battle data'
      )
    }

    return { aligned, configBoss, liveBoss, level: 'L2' }
  }
