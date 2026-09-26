import 'server-only'

import { db } from '@/app/lib/db'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { getPlaybookId } from '@/app/lib/boss-playbooks/playbook-id'
import { TERMINUS_SOURCE_SYSTEM } from '@/app/lib/replays/replay-source'
import {
  CATALOG_PAGE_SIZE,
  CATALOG_SORTS,
  type CatalogSort,
  type CommunityReplay,
  type CommunityReplayFacets,
  type CommunityReplayFilters,
  type CommunityReplayPage
} from '@/app/lib/replays/community-replay-catalog-shared'

export * from '@/app/lib/replays/community-replay-catalog-shared'

// Reads use the authenticated RLS client, never the service role: the visibility policy alone
// decides what a viewer sees, and this module adds no visibility logic that could widen it.

const CATALOG_SELECT = [
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
  'encounter_role'
].join(',')

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []

const mapRow = (row: Record<string, unknown>): CommunityReplay => {
  const bossId = typeof row.boss_id === 'string' ? row.boss_id : null
  const bossName = bossId ? getBossDisplayName(bossId) : 'Unknown boss'
  const playbookId = bossId ? getPlaybookId(bossName) : null
  const season =
    row.season === null || row.season === undefined ? null : String(row.season)
  return {
    id: String(row.id),
    title:
      typeof row.title === 'string' && row.title.trim()
        ? row.title.trim()
        : 'Replay',
    bossId,
    bossName,
    difficulty: typeof row.difficulty === 'string' ? row.difficulty : null,
    raritySet: typeof row.rarity_set === 'string' ? row.rarity_set : null,
    mapId: typeof row.map_id === 'string' ? row.map_id : null,
    damage: typeof row.damage === 'number' ? row.damage : null,
    units: toStringArray(row.units),
    season,
    encounterRole:
      typeof row.encounter_role === 'string' ? row.encounter_role : null,
    isFeatured: Boolean(row.is_featured),
    visibility: typeof row.visibility === 'string' ? row.visibility : null,
    videoUrl: typeof row.video_url === 'string' ? row.video_url : null,
    videoType: typeof row.video_type === 'string' ? row.video_type : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    tags: toStringArray(row.tags),
    href: playbookId
      ? `/boss-playbooks/${encodeURIComponent(playbookId)}?replay=${encodeURIComponent(String(row.id))}`
      : '/replays'
  }
}

// PostgREST 400s on unescaped commas/parens inside `or(...)`.
const sanitizeSearch = (term: string) =>
  term
    .replace(/[,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

/* eslint-disable @typescript-eslint/no-explicit-any -- boss_playbook_replays columns run ahead of the generated app DB types */
const applyFilters = (query: any, filters: CommunityReplayFilters) => {
  // Non-negotiable and applied first: this site surfaces the Terminus lane only.
  let next = query.eq('source_system', TERMINUS_SOURCE_SYSTEM)
  if (filters.boss) next = next.eq('boss_id', filters.boss)
  if (filters.board) next = next.eq('map_id', filters.board)
  if (filters.difficulty) next = next.eq('rarity_set', filters.difficulty)
  if (filters.season) next = next.eq('season', filters.season)
  if (filters.role) next = next.eq('encounter_role', filters.role)
  if (filters.featuredOnly) next = next.eq('is_featured', true)
  if (filters.withVideoOnly) next = next.not('video_url', 'is', null)
  const search = filters.search ? sanitizeSearch(filters.search) : ''
  if (search) {
    next = next.or(`title.ilike.%${search}%,boss_id.ilike.%${search}%`)
  }
  return next
}

export async function loadCommunityReplayPage(
  filters: CommunityReplayFilters,
  { page = 1, sort = 'damage' }: { page?: number; sort?: CatalogSort } = {}
): Promise<CommunityReplayPage> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const from = (safePage - 1) * CATALOG_PAGE_SIZE
  const to = from + CATALOG_PAGE_SIZE - 1
  const { column, ascending } = CATALOG_SORTS[sort] ?? CATALOG_SORTS.damage

  try {
    const supabase = await db()
    const query = applyFilters(
      (supabase as any)
        .from('boss_playbook_replays')
        .select(CATALOG_SELECT, { count: 'exact' }),
      filters
    )
      .order(column, { ascending, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)

    const { data, error, count } = await query
    if (error) {
      console.warn('[replays] Failed to load community replay catalog', {
        error: error.message
      })
      return {
        replays: [],
        total: 0,
        page: safePage,
        pageSize: CATALOG_PAGE_SIZE,
        loadFailed: true
      }
    }

    return {
      replays: ((data ?? []) as Array<Record<string, unknown>>).map(mapRow),
      total: typeof count === 'number' ? count : 0,
      page: safePage,
      pageSize: CATALOG_PAGE_SIZE,
      loadFailed: false
    }
  } catch (error) {
    console.warn('[replays] Failed to load community replay catalog', {
      error: error instanceof Error ? error.message : String(error)
    })
    return {
      replays: [],
      total: 0,
      page: safePage,
      pageSize: CATALOG_PAGE_SIZE,
      loadFailed: true
    }
  }
}

/** Facet counts from one bounded narrow scan (the table is small) so they share a snapshot. */
export async function loadCommunityReplayFacets(): Promise<CommunityReplayFacets> {
  const empty: CommunityReplayFacets = {
    bosses: [],
    difficulties: [],
    seasons: []
  }
  try {
    const supabase = await db()
    const { data, error } = await (supabase as any)
      .from('boss_playbook_replays')
      .select('boss_id, rarity_set, season')
      .eq('source_system', TERMINUS_SOURCE_SYSTEM)
      .limit(5000)

    if (error) {
      console.warn('[replays] Failed to load catalog facets', {
        error: error.message
      })
      return empty
    }

    const bosses = new Map<string, number>()
    const difficulties = new Map<string, number>()
    const seasons = new Map<string, number>()
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.boss_id === 'string' && row.boss_id) {
        bosses.set(row.boss_id, (bosses.get(row.boss_id) ?? 0) + 1)
      }
      if (typeof row.rarity_set === 'string' && row.rarity_set) {
        difficulties.set(
          row.rarity_set,
          (difficulties.get(row.rarity_set) ?? 0) + 1
        )
      }
      if (row.season !== null && row.season !== undefined) {
        const season = String(row.season)
        seasons.set(season, (seasons.get(season) ?? 0) + 1)
      }
    }

    return {
      bosses: Array.from(bosses, ([value, count]) => ({
        value,
        label: getBossDisplayName(value),
        count
      })).sort((a, b) => a.label.localeCompare(b.label)),
      difficulties: Array.from(difficulties, ([value, count]) => ({
        value,
        count
      })).sort((a, b) => a.value.localeCompare(b.value)),
      seasons: Array.from(seasons, ([value, count]) => ({
        value,
        count
      })).sort((a, b) => Number(b.value) - Number(a.value))
    }
  } catch (error) {
    console.warn('[replays] Failed to load catalog facets', {
      error: error instanceof Error ? error.message : String(error)
    })
    return empty
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
