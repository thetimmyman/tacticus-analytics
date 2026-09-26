import portraitManifest from '@/public/images/portraits/manifest.json'
import type { UnitRarity } from './roster-helpers'

// Tile art from an attested Tacticus LIVE build (Snowprint art, used with written permission).

/** Native frame aspect ratio (190x247). */
export const TILE_ASPECT_RATIO = '190 / 247'

const PORTRAIT_UNITS = new Set(Object.keys(portraitManifest.units))

/** Keyed by hero_mappings.unit_id; null means callers fall back to the round icon. */
export function getPortraitUrl(unitId: string): string | null {
  return PORTRAIT_UNITS.has(unitId) ? `/images/portraits/${unitId}.webp` : null
}

const RARITY_SLUG: Record<UnitRarity, string> = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  Epic: 'epic',
  Legendary: 'legendary',
  Mythic: 'mythic'
}

/** Every rarity has a frame, so this never returns null. */
export function getFrameUrl(rarity: UnitRarity): string {
  return `/images/frames/${RARITY_SLUG[rarity] ?? 'common'}.webp`
}

export type StarTier = 'common' | 'epic' | 'legendary' | 'mythic'

/** Mirrors StarDisplay: 1-5 gold (n), 6-10 red (n-5), 11-13 cyan (n-10), 14 one winged skull. */
export function getStarTier(stars: number): {
  tier: StarTier
  count: number
} | null {
  if (stars <= 0) return null
  if (stars >= 14) return { tier: 'mythic', count: 1 }
  if (stars >= 11) return { tier: 'legendary', count: stars - 10 }
  if (stars >= 6) return { tier: 'epic', count: stars - 5 }
  return { tier: 'common', count: stars }
}

export function getStarUrl(tier: StarTier): string {
  return `/images/stars/${tier}.webp`
}

export const TILE_ART_SOURCE_BUILD = portraitManifest.sourceBuildId
