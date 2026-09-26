// Pure: callers pass resolved season numbers because getSeasonConfigIdForOffset is server-only.

import type { SeasonOption } from '@/app/components/ui/SeasonSelectorPills'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'

// Offsets around the global current season, mirroring the SeasonalBossHub window.
export const SEASON_WINDOW_OFFSETS = [-2, -1, 0, 1, 2] as const

/** Relative to the cluster's LIVE season, so a lagging cluster still reads "Live", "Next". */
export function seasonWindowLabel(
  seasonNumber: number,
  clusterLatestSeason: number
): string {
  const delta = seasonNumber - clusterLatestSeason
  if (delta === 0) return `Live · S${seasonNumber}`
  if (delta === 1) return `Next · S${seasonNumber}`
  if (delta === -1) return `Prior · S${seasonNumber}`
  return `S${seasonNumber}`
}

/** Always includes the live anchor, even outside the window; de-duped, positive, ascending. */
export function buildSeasonWindowOptions(
  windowSeasonNumbers: number[],
  clusterLatestSeason: number
): SeasonOption[] {
  const set = new Set<number>(
    windowSeasonNumbers.filter((n) => Number.isFinite(n) && n > 0)
  )
  if (Number.isFinite(clusterLatestSeason) && clusterLatestSeason > 0) {
    set.add(clusterLatestSeason)
  }
  return Array.from(set)
    .sort((a, b) => a - b)
    .map((n) => ({
      value: String(n),
      label: seasonWindowLabel(n, clusterLatestSeason)
    }))
}

export interface SeasonConfigResolution {
  seasonNumber: number
  configId: string
}

export function resolveSeasonConfigId(
  resolutions: readonly SeasonConfigResolution[],
  seasonNumber: string | number
): string | null {
  const target =
    typeof seasonNumber === 'number'
      ? seasonNumber
      : Number.parseInt(seasonNumber, 10)
  if (!Number.isFinite(target)) return null
  return (
    resolutions.find((resolution) => resolution.seasonNumber === target)
      ?.configId ?? null
  )
}

export function buildSeasonWindowNumbers(
  rotationSeasonNumbers: readonly number[],
  selectedSeason: string
): number[] {
  return [...rotationSeasonNumbers, Number.parseInt(selectedSeason, 10)]
}

/**
 * Anchors on the cluster's live season (get_cluster_latest_season), not getLatestSeason():
 * only it shows the interactive queue. No ?season selects it.
 */
export function resolveSelectedSeason(
  seasonOverride: string | null | undefined,
  clusterLatestSeason: string
): { selectedSeason: string; isLiveSeason: boolean } {
  const liveSeason =
    parseSeasonParam(clusterLatestSeason) ?? clusterLatestSeason
  const selectedSeason = parseSeasonParam(seasonOverride) ?? liveSeason
  return {
    selectedSeason,
    isLiveSeason: selectedSeason === liveSeason
  }
}
