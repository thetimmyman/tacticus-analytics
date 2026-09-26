import 'server-only'

import { db, serviceDb } from '@/app/lib/db'
import { toInternalStorageUrlMap } from '@/app/lib/images/internal-storage-url'
import {
  getSeasonConfigIdForOffset,
  getSeasonLineup,
  getSeasonPosition
} from '@/app/lib/loki/season-configs'
import { isOfficerSkip } from '@/app/lib/boss-assignments/target-token-season'
// Shared so the targets page can read encounter ops without this heavy module.
import {
  loadHeraldConfigsByBossId,
  loadSeasonOpsBySlot
} from '@/app/lib/boss-ops/load-encounter-ops'
import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'
import { TERMINUS_SOURCE_SYSTEM } from '@/app/lib/replays/replay-source'
import type { PlaybooksData } from './types'
import {
  buildSeasonalBossHubData,
  guildFeaturedPinKey,
  seasonalBattleMetricKey,
  seasonalMetaAtlasTeamKey,
  seasonalTargetTokenKey,
  seasonalTargetTokenSeasonKey,
  type SeasonalHubBattleMetrics,
  type SeasonalHubBossMappingRow,
  type SeasonalBossHubData,
  type SeasonalHubMetaAtlasTeam,
  type SeasonalHubReplayLinkMode,
  type SeasonalHubReplayRow,
  type SeasonalHubTargetToken,
  type SeasonalHubRarity
} from './seasonal-hub-utils'

const SEASON_WINDOW_OFFSETS = [-1, 0, 1, 2, 3, 4] as const
// 20 keeps main-boss "top team" meaningful; primes see far fewer attacks.
const META_ATLAS_MAIN_MIN_ATTACKS = 20
const META_ATLAS_PRIME_MIN_ATTACKS = 10

const REPLAY_SELECT = [
  'id',
  'boss_id',
  'title',
  'difficulty',
  'rarity_set',
  'map_id',
  'damage',
  'units',
  'season',
  'is_featured',
  'created_at',
  'video_type',
  'video_url',
  'visibility',
  'tags',
  // Authoritative encounter classification (see replayEncounterRole()).
  'encounter_role'
].join(',')

type SeasonalBossHubLoadOptions = {
  guildCode?: string | null
  canManageHerald?: boolean
  canManageTargets?: boolean
  /** Only one season is serialized; the switcher fetches others on demand. */
  seasonNumber?: number
}

async function loadMapImageUrlsByBoardId(
  boardIds: string[]
): Promise<Record<string, string | null>> {
  if (boardIds.length === 0) return {}

  try {
    const supabase = serviceDb()
    // Public map image metadata only; replays stay on the authenticated RLS client.
    const { data, error } = await supabase
      .from('maps')
      .select('id, image_url')
      .in('id', boardIds)

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load map images', {
        error: error.message
      })
      return {}
    }

    // Internal origin: <Image>'s optimizer fetches server-side from inside the cluster.
    return toInternalStorageUrlMap(
      Object.fromEntries(
        (data ?? []).map((row) => [String(row.id), row.image_url ?? null])
      )
    )
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load map images', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {}
  }
}

const normalizeGuildReplayLinkMode = (
  value: unknown
): Exclude<SeasonalHubReplayLinkMode, 'inherit'> => {
  return value === 'pinned' || value === 'featured' || value === 'all'
    ? value
    : 'off'
}

/**
 * Authenticated RLS client (never service role) so viewers see only entitled rows. The
 * TERMINUS_SOURCE_SYSTEM filter keeps out uploaded videos and Discord forum submissions.
 */
async function loadVisibleReplayRows(): Promise<SeasonalHubReplayRow[]> {
  try {
    const supabase = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- boss_playbook_replays columns run ahead of the generated app DB types
    const query = (supabase as any)
      .from('boss_playbook_replays')
      .select(REPLAY_SELECT)
      .eq('source_system', TERMINUS_SOURCE_SYSTEM)
      .order('is_featured', { ascending: false })
      .order('damage', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(2500)

    const { data, error } = await query
    if (error) {
      console.warn('[seasonal-playbooks] Failed to load visible replays', {
        error: error.message
      })
      return []
    }

    return (data ?? []) as SeasonalHubReplayRow[]
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load visible replays', {
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

async function loadGuildReplayLinkMode(
  guildCode: string | null | undefined,
  enabled: boolean
): Promise<Exclude<SeasonalHubReplayLinkMode, 'inherit'>> {
  if (!guildCode || !enabled) return 'off'

  try {
    const supabase = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- guild_config generated type can lag Herald columns
    const { data, error } = await (supabase.from('guild_config') as any)
      .select('herald_replay_link_mode')
      .eq('guild_code', guildCode)
      .maybeSingle()

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load guild replay mode', {
        error: error.message
      })
      return 'off'
    }

    return normalizeGuildReplayLinkMode(data?.herald_replay_link_mode)
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load guild replay mode', {
      error: error instanceof Error ? error.message : String(error)
    })
    return 'off'
  }
}

/** Explicit guild filter so app-admin sessions stay scoped to the rendered guild. */
async function loadGuildFeaturedPinsByKey(
  guildCode: string | null
): Promise<Record<string, string>> {
  if (!guildCode) return {}

  try {
    const supabase = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- replay tables intentionally remain outside this app's generated DB surface
    const { data, error } = await (supabase as any)
      .from('guild_featured_replays')
      .select('boss_id, encounter_role, replay_id')
      .eq('guild_code', guildCode)
      .is('season', null)

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load guild replay pins', {
        error: error.message
      })
      return {}
    }

    const out: Record<string, string> = {}
    ;((data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const bossId = typeof row.boss_id === 'string' ? row.boss_id : ''
      const encounterRole =
        typeof row.encounter_role === 'string' ? row.encounter_role : ''
      const replayId = typeof row.replay_id === 'string' ? row.replay_id : ''
      if (!bossId || !encounterRole || !replayId) return
      out[guildFeaturedPinKey(bossId, encounterRole)] = replayId
    })
    return out
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load guild replay pins', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {}
  }
}

async function loadBossMappings(
  bossTypes: string[]
): Promise<SeasonalHubBossMappingRow[]> {
  const distinctBossTypes = Array.from(
    new Set(bossTypes.map((bossType) => bossType.trim()).filter(Boolean))
  )
  if (distinctBossTypes.length === 0) return []

  try {
    const supabase = await db()
    const { data, error } = await supabase
      .from('boss_mapping')
      .select(
        'boss_type, encounter_index, boss_name, asset_slug, portrait_path, icon_path, thumbnail_path'
      )
      .in('boss_type', distinctBossTypes)

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load boss mappings', {
        error: error.message
      })
      return []
    }

    return (data ?? []) as SeasonalHubBossMappingRow[]
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load boss mappings', {
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

async function loadBattleMetricsBySeason(
  guildCode: string | null | undefined,
  seasonNumbers: number[]
): Promise<Record<string, Record<string, SeasonalHubBattleMetrics>>> {
  if (!guildCode || seasonNumbers.length === 0) return {}

  try {
    const supabase = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EOT_GR_data generated type is intentionally narrow in older app packages
    const { data, error } = await (supabase.from('EOT_GR_data') as any)
      .select('Season, rarity, set, encounterId, damageDealt, loopIndex')
      .eq('Guild', guildCode)
      .in(
        'Season',
        Array.from(new Set(seasonNumbers.map((season) => String(season))))
      )
      .in('rarity', ['Legendary', 'Mythic'])
      .in('encounterId', [0, 1, 2])
      .eq('damageType', 'Battle')
      .order('startedOn', { ascending: false })

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load battle metrics', {
        error: error.message
      })
      return {}
    }

    type Bucket = {
      totalDamage: number
      sampleCount: number
      loops: Map<number, number>
    }
    const buckets = new Map<string, Bucket>()

    ;((data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const season = Number(row.Season)
      const rarity =
        row.rarity === 'Mythic' || row.rarity === 'Legendary'
          ? (row.rarity as SeasonalHubRarity)
          : null
      const setNumber =
        typeof row.set === 'number'
          ? row.set
          : Number.parseInt(String(row.set ?? ''), 10)
      const encounterIndex =
        typeof row.encounterId === 'number'
          ? row.encounterId
          : Number.parseInt(String(row.encounterId ?? ''), 10)
      const damage =
        typeof row.damageDealt === 'number'
          ? row.damageDealt
          : Number.parseFloat(String(row.damageDealt ?? ''))
      if (
        !Number.isFinite(season) ||
        !rarity ||
        !Number.isFinite(setNumber) ||
        !Number.isFinite(encounterIndex) ||
        encounterIndex < 0 ||
        encounterIndex > 2 ||
        !Number.isFinite(damage) ||
        damage < 0
      ) {
        return
      }

      const slotKey = seasonalBattleMetricKey({
        rarity,
        setNumber,
        encounterIndex
      })
      const key = `${season}__${slotKey}`
      const bucket = buckets.get(key) ?? {
        totalDamage: 0,
        sampleCount: 0,
        loops: new Map()
      }
      bucket.totalDamage += damage
      bucket.sampleCount += 1
      const loopIndex =
        typeof row.loopIndex === 'number'
          ? row.loopIndex
          : Number.parseInt(String(row.loopIndex ?? '0'), 10)
      const loop = Number.isFinite(loopIndex) ? loopIndex : 0
      bucket.loops.set(loop, (bucket.loops.get(loop) ?? 0) + 1)
      buckets.set(key, bucket)
    })

    const out: Record<string, Record<string, SeasonalHubBattleMetrics>> = {}
    buckets.forEach((bucket, key) => {
      const [season, ...slotParts] = key.split('__')
      const slotKey = slotParts.join('__')
      if (!season || !slotKey) return
      out[season] ??= {}
      out[season][slotKey] = {
        averageDamage:
          bucket.sampleCount > 0
            ? bucket.totalDamage / bucket.sampleCount
            : null,
        totalDamage: bucket.totalDamage,
        sampleCount: bucket.sampleCount,
        totalTokens: bucket.sampleCount,
        tokensByLoop: Array.from(bucket.loops.entries())
          .map(([loopIndex, tokens]) => ({ loopIndex, tokens }))
          .sort((a, b) => a.loopIndex - b.loopIndex)
      }
    })
    return out
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load battle metrics', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {}
  }
}

// Only rarityIndex 4 and 5 have a difficulty code; `set` is 0-based, so shift it.
const raritySetForEncounter = (
  rarityIndex: number | null | undefined,
  set: number
) => {
  if (rarityIndex !== 4 && rarityIndex !== 5) return null
  return difficultyCodeFromOneBasedSet(
    rarityIndex === 5 ? 'Mythic' : 'Legendary',
    set + 1
  )
}

const parseMetaAtlasTeamUnits = (
  composition: string | null | undefined
): string[] => {
  if (!composition) return []
  const [heroPart, mowPart] = composition.split(' + ')
  const units = (heroPart ?? '')
    .split(',')
    .map((hero) => hero.trim())
    .filter(Boolean)
  const mow = mowPart?.trim()
  if (mow) units.push(mow)
  return units
}

const toNumberOrNull = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

async function loadMetaAtlasTopTeamsBySlot(
  bossTypes: string[],
  raritySets: string[]
): Promise<Record<string, SeasonalHubMetaAtlasTeam>> {
  const distinctBossTypes = Array.from(
    new Set(bossTypes.map((bossType) => bossType.trim()).filter(Boolean))
  )
  const distinctRaritySets = Array.from(
    new Set(raritySets.map((raritySet) => raritySet.trim()).filter(Boolean))
  )
  if (distinctBossTypes.length === 0 || distinctRaritySets.length === 0) {
    return {}
  }

  try {
    const supabase = serviceDb()
    // Winners resolved DB-side: a JS reduce over a wide scan would hit the PostgREST row cap.
    // serviceDb because these are aggregate benchmark rows, not private replays.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC is ahead of generated types in this app package
    const { data, error } = await (supabase.rpc as any)(
      'get_seasonal_meta_atlas_top_teams',
      {
        p_boss_types: distinctBossTypes,
        p_rarity_sets: distinctRaritySets,
        p_main_min_attacks: META_ATLAS_MAIN_MIN_ATTACKS,
        p_prime_min_attacks: META_ATLAS_PRIME_MIN_ATTACKS
      }
    )

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load Meta Atlas teams', {
        error: error.message
      })
      return {}
    }

    const out: Record<string, SeasonalHubMetaAtlasTeam> = {}
    ;((data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const bossType = typeof row.boss_type === 'string' ? row.boss_type : ''
      const raritySet = typeof row.rarity_set === 'string' ? row.rarity_set : ''
      const rawEncounterIndex = toNumberOrNull(row.encounter_index)
      const encounterIndex =
        rawEncounterIndex === null
          ? 0
          : Math.max(0, Math.floor(rawEncounterIndex))
      if (!bossType || !raritySet || encounterIndex > 2) return

      const key = seasonalMetaAtlasTeamKey({
        bossType,
        raritySet,
        encounterIndex
      })
      const teamComposition =
        typeof row.team_composition === 'string' ? row.team_composition : null
      out[key] = {
        teamHash: typeof row.team_hash === 'string' ? row.team_hash : null,
        teamComposition,
        metaTeam: typeof row.meta_team === 'string' ? row.meta_team : null,
        raritySet,
        units: parseMetaAtlasTeamUnits(teamComposition),
        damageP90: toNumberOrNull(row.damage_p90),
        damageP75: toNumberOrNull(row.damage_p75),
        damageAvg: toNumberOrNull(row.damage_avg),
        attackCount: toNumberOrNull(row.attack_count),
        season:
          row.season === null || row.season === undefined
            ? null
            : String(row.season)
      }
    })

    return out
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load Meta Atlas teams', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {}
  }
}

async function loadTargetTokensBySlot(
  guildCode: string | null | undefined
): Promise<Record<string, SeasonalHubTargetToken>> {
  if (!guildCode) return {}

  try {
    const supabase = await db()
    // Keyed by seasonalTargetTokenSeasonKey; the renderer prefers the season row over '' legacy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- boss_target_tokens is ahead of generated app DB types
    const { data, error } = await (supabase.from('boss_target_tokens') as any)
      .select(
        'boss_name, rarity, set, encounter_id, target_tokens, source, seeded_from_seasons, skip, season_number'
      )
      .eq('guild_code', guildCode)

    if (error) {
      console.warn('[seasonal-playbooks] Failed to load target tokens', {
        error: error.message
      })
      return {}
    }

    const out: Record<string, SeasonalHubTargetToken> = {}
    ;((data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const bossType = typeof row.boss_name === 'string' ? row.boss_name : ''
      const rarity =
        row.rarity === 'Mythic' || row.rarity === 'Legendary'
          ? (row.rarity as SeasonalHubRarity)
          : null
      const setOneIndexed =
        typeof row.set === 'number'
          ? row.set
          : Number.parseInt(String(row.set ?? ''), 10)
      const encounterIndex =
        typeof row.encounter_id === 'number'
          ? row.encounter_id
          : Number.parseInt(String(row.encounter_id ?? ''), 10)
      const targetTokens =
        typeof row.target_tokens === 'number'
          ? row.target_tokens
          : Number.parseFloat(String(row.target_tokens ?? ''))
      if (
        !bossType ||
        !rarity ||
        !Number.isFinite(setOneIndexed) ||
        setOneIndexed < 1 ||
        !Number.isFinite(encounterIndex) ||
        encounterIndex < 0 ||
        encounterIndex > 2 ||
        !Number.isFinite(targetTokens)
      ) {
        return
      }
      const seasonNumber =
        typeof row.season_number === 'string' ? row.season_number : ''
      const source = typeof row.source === 'string' ? row.source : null
      const seededFromSeasons =
        typeof row.seeded_from_seasons === 'string'
          ? row.seeded_from_seasons
          : null
      const slotKey = seasonalTargetTokenKey({
        bossType,
        rarity,
        setNumber: setOneIndexed - 1,
        encounterIndex
      })
      out[seasonalTargetTokenSeasonKey(seasonNumber, slotKey)] = {
        targetTokens,
        skip:
          encounterIndex === 0
            ? false
            : isOfficerSkip({
                skip: row.skip === true,
                source,
                seeded_from_seasons: seededFromSeasons
              }),
        source
      }
    })
    return out
  } catch (error) {
    console.warn('[seasonal-playbooks] Failed to load target tokens', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {}
  }
}

const seasonLabel = (offset: number, seasonNumber: number) => {
  const prefix: Record<number, string> = {
    [-1]: 'Prior',
    [0]: 'Current',
    [1]: 'Next'
  }
  return prefix[offset]
    ? `${prefix[offset]} · S${seasonNumber}`
    : `S${seasonNumber}`
}

export async function loadSeasonalBossHubData(
  playbooks: PlaybooksData,
  options: SeasonalBossHubLoadOptions = {}
): Promise<SeasonalBossHubData | null> {
  const { seasonNumber } = getSeasonPosition()
  const guildCode = options.guildCode ?? null
  const canManageHerald = options.canManageHerald === true
  const canManageTargets = options.canManageTargets === true
  const seasonWindow = SEASON_WINDOW_OFFSETS.map((offset) => {
    const season = getSeasonConfigIdForOffset(offset)
    return {
      offset,
      ...season,
      lineup: getSeasonLineup(season.seasonNumber)
    }
  })

  const availableLineups = seasonWindow
    .map((season) => season.lineup)
    .filter((lineup): lineup is NonNullable<typeof lineup> => Boolean(lineup))

  if (availableLineups.length === 0) return null

  const requestedSeasonNumber = options.seasonNumber ?? seasonNumber
  const selectedLineup =
    availableLineups.find(
      (lineup) => lineup.season === requestedSeasonNumber
    ) ?? (options.seasonNumber === undefined ? availableLineups[0] : null)
  if (!selectedLineup) return null

  // Only the selected season loads heavy inputs; others load via the seasonal-hub endpoint.
  const scopedLineups = [selectedLineup]

  const boardIds = Array.from(
    new Set(
      scopedLineups
        .flatMap((lineup) => lineup.encounters)
        .map((encounter) => encounter.boardId)
        .filter((boardId): boardId is string => Boolean(boardId))
    )
  )

  const bossTypes = scopedLineups
    .flatMap((lineup) => lineup.encounters)
    .map((encounter) => encounter.bossType)
  const raritySets = scopedLineups
    .flatMap((lineup) => lineup.encounters)
    .map((encounter) =>
      raritySetForEncounter(encounter.rarityIndex, encounter.set)
    )
    .filter((raritySet): raritySet is string => Boolean(raritySet))
  const seasonNumbers = [selectedLineup.season]

  const [
    mapImageUrlsByBoardId,
    replays,
    bossMappings,
    battleMetricsBySeason,
    targetTokensBySlot,
    metaAtlasTeamsBySlot,
    heraldConfigLoad,
    seasonOpsLoad,
    guildReplayLinkMode,
    guildPinnedReplayIdsByKey
  ] = await Promise.all([
    loadMapImageUrlsByBoardId(boardIds),
    loadVisibleReplayRows(),
    loadBossMappings(bossTypes),
    loadBattleMetricsBySeason(guildCode, seasonNumbers),
    loadTargetTokensBySlot(guildCode),
    loadMetaAtlasTopTeamsBySlot(bossTypes, raritySets),
    // Keep `loadFailed`: a dropped read error becomes a silent clobber (see `opsLoadFailed`).
    loadHeraldConfigsByBossId(guildCode, canManageHerald),
    loadSeasonOpsBySlot(guildCode, seasonNumbers, canManageHerald),
    loadGuildReplayLinkMode(guildCode, canManageHerald),
    loadGuildFeaturedPinsByKey(guildCode)
  ])

  const heraldConfigsByBossId = heraldConfigLoad.byBossId
  const seasonOpsBySlot = seasonOpsLoad.bySlot
  const opsLoadFailed = heraldConfigLoad.loadFailed || seasonOpsLoad.loadFailed

  const selectedSeason = buildSeasonalBossHubData({
    lineup: selectedLineup,
    playbooks,
    replays,
    mapImageUrlsByBoardId,
    bossMappings,
    battleMetricsBySlot:
      battleMetricsBySeason[String(selectedLineup.season)] ?? {},
    targetTokensBySlot,
    metaAtlasTeamsBySlot,
    heraldConfigsByBossId,
    seasonOpsBySlot,
    guildPinnedReplayIdsByKey,
    guildCode,
    canManageHerald,
    canManageTargets,
    guildReplayLinkMode
  })

  return {
    ...selectedSeason,
    currentSeasonNumber: seasonNumber,
    seasonOptions: seasonWindow.map((season) => ({
      value: String(season.seasonNumber),
      seasonNumber: season.seasonNumber,
      label: seasonLabel(season.offset, season.seasonNumber),
      offset: season.offset,
      isCurrent: season.offset === 0,
      available: Boolean(season.lineup)
    })),
    guildCode,
    canManageHerald,
    canManageTargets,
    opsLoadFailed
  }
}
