import rawIndex from '@/public/images/game-assets/guild-war/index.json'

// Accessors over the extractor output (art and layout only). The 5x3 grid changes across
// seasons A-D, so derive from GlobalConfig; never hardcode.

const ASSET_BASE = '/images/game-assets/guild-war'

export interface GuildWarZoneType {
  visualId: string | null
  buffId: string | null
  canBeMoved: boolean | null
  score: number | null
}

export interface GuildWarMapPoolEntry {
  boardId: string
  spawnPointsSet: number | null
}

export interface GuildWarSeason {
  zoneGrid: string[][]
  nextSeasonConfigId: string | null
  mapPool: GuildWarMapPoolEntry[]
  zoneTypes: Record<string, GuildWarZoneType>
}

interface GuildWarMapIndex {
  schemaVersion: number
  sourceBuildId: string
  provenanceClass: string
  note: string
  seasons: Record<string, GuildWarSeason>
  zoneIcons: Record<string, string>
  boardThumbnails: Record<string, string>
  boardsMissingArt: string[]
}

const index = rawIndex as unknown as GuildWarMapIndex

export const guildWarSourceBuildId = index.sourceBuildId

export const guildWarSeasonIds = Object.keys(index.seasons).sort()

export function getGuildWarSeason(seasonId: string): GuildWarSeason | null {
  return index.seasons[seasonId] ?? null
}

export function zoneIconUrl(
  visualId: string | null | undefined
): string | null {
  if (!visualId) return null
  // Config is camelCase; bundles are lowercase.
  const rel = index.zoneIcons[visualId.toLowerCase()]
  return rel ? `${ASSET_BASE}/${rel}` : null
}

export function boardThumbnailUrl(boardId: string): string | null {
  const rel = index.boardThumbnails[boardId]
  return rel ? `${ASSET_BASE}/${rel}` : null
}

/** Season whose zone grid best explains the observed zone types; the first one without signal. */
export function inferSeasonId(observedZoneTypes: readonly string[]): string {
  const fallback = guildWarSeasonIds[0] ?? ''
  if (observedZoneTypes.length === 0) return fallback
  const observed = new Set(observedZoneTypes)
  let bestId = fallback
  let bestScore = -1
  for (const id of guildWarSeasonIds) {
    const grid = index.seasons[id]?.zoneGrid ?? []
    const zones = grid.flat()
    if (zones.length === 0) continue
    const score = zones.reduce((n, z) => n + (observed.has(z) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestId = id
    }
  }
  return bestId
}

export function seasonLabel(seasonId: string): string {
  const suffix = seasonId.replace(/^guildWarSeason/, '')
  return suffix ? `Season ${suffix}` : seasonId
}
