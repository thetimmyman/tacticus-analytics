// Client-safe: no `server-only`, db or Node imports (the client catalogue page imports it).

export const CATALOG_PAGE_SIZE = 48

/** Sorts the UI offers. Keys are part of the URL, so treat them as stable. */
export const CATALOG_SORTS = {
  damage: { label: 'Highest damage', column: 'damage', ascending: false },
  recent: { label: 'Newest', column: 'created_at', ascending: false },
  featured: { label: 'Featured first', column: 'is_featured', ascending: false }
} as const

export type CatalogSort = keyof typeof CATALOG_SORTS

export const isCatalogSort = (value: unknown): value is CatalogSort =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(CATALOG_SORTS, value)

export type CommunityReplay = {
  id: string
  title: string
  bossId: string | null
  bossName: string
  difficulty: string | null
  raritySet: string | null
  mapId: string | null
  damage: number | null
  units: string[]
  season: string | null
  encounterRole: string | null
  isFeatured: boolean
  visibility: string | null
  videoUrl: string | null
  videoType: string | null
  createdAt: string | null
  tags: string[]
  href: string
}

export type CommunityReplayFilters = {
  boss?: string | null
  board?: string | null
  difficulty?: string | null
  season?: string | null
  role?: string | null
  featuredOnly?: boolean
  withVideoOnly?: boolean
  search?: string | null
}

export type CommunityReplayPage = {
  replays: CommunityReplay[]
  total: number
  page: number
  pageSize: number
  loadFailed: boolean
}

export type CommunityReplayFacets = {
  bosses: { value: string; label: string; count: number }[]
  difficulties: { value: string; count: number }[]
  seasons: { value: string; count: number }[]
}
