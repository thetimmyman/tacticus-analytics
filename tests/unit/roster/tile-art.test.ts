import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getFrameUrl,
  getPortraitUrl,
  getStarTier,
  getStarUrl,
  TILE_ART_SOURCE_BUILD
} from '@/app/(dashboard)/roster/utils/tile-art'
import type { UnitRarity } from '@/app/(dashboard)/roster/utils/roster-helpers'

const PUBLIC_DIR = join(process.cwd(), 'public')
const manifest = JSON.parse(
  readFileSync(join(PUBLIC_DIR, 'images/portraits/manifest.json'), 'utf8')
) as { units: Record<string, string>; count: number; sourceBuildId: string }

const RARITIES: UnitRarity[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic'
]

function assetExists(url: string): boolean {
  return existsSync(join(PUBLIC_DIR, url.replace(/^\//, '')))
}

describe('roster tile art assets', () => {
  it('has a non-empty portrait manifest (positive control)', () => {
    expect(manifest.count).toBeGreaterThan(100)
    expect(Object.keys(manifest.units)).toHaveLength(manifest.count)
    expect(TILE_ART_SOURCE_BUILD).toBe(manifest.sourceBuildId)
  })

  it('resolves a manifest unit to its portrait URL and a real file', () => {
    expect(getPortraitUrl('adeptCanoness')).toBe(
      '/images/portraits/adeptCanoness.webp'
    )
    expect(assetExists('/images/portraits/adeptCanoness.webp')).toBe(true)
  })

  it('ships a real file for every portrait the manifest advertises', () => {
    const missing = Object.keys(manifest.units).filter((unitId) => {
      const url = getPortraitUrl(unitId)
      return url === null || !assetExists(url)
    })
    expect(missing).toEqual([])
  })

  it('returns null for an unvendored unit so callers use the catalog fallback', () => {
    expect(getPortraitUrl('unitAddedAfterTheLastExtraction')).toBeNull()
  })

  it('ships a frame file for every rarity', () => {
    const missing = RARITIES.filter(
      (rarity) => !assetExists(getFrameUrl(rarity))
    )
    expect(missing).toEqual([])
  })

  it('ships a sprite for every star tier', () => {
    const tiers = ['common', 'epic', 'legendary', 'mythic'] as const
    const missing = tiers.filter((tier) => !assetExists(getStarUrl(tier)))
    expect(missing).toEqual([])
  })
})

describe('getStarTier', () => {
  it('returns null below one star', () => {
    expect(getStarTier(0)).toBeNull()
    expect(getStarTier(-1)).toBeNull()
  })

  it('maps 1-5 to gold pips counted directly', () => {
    expect(getStarTier(1)).toEqual({ tier: 'common', count: 1 })
    expect(getStarTier(5)).toEqual({ tier: 'common', count: 5 })
  })

  it('maps 6-10 to red pips restarting the count', () => {
    expect(getStarTier(6)).toEqual({ tier: 'epic', count: 1 })
    expect(getStarTier(10)).toEqual({ tier: 'epic', count: 5 })
  })

  it('maps 11-13 to cyan pips restarting the count', () => {
    expect(getStarTier(11)).toEqual({ tier: 'legendary', count: 1 })
    expect(getStarTier(13)).toEqual({ tier: 'legendary', count: 3 })
  })

  it('renders 14 stars as a single winged-skull ornament', () => {
    expect(getStarTier(14)).toEqual({ tier: 'mythic', count: 1 })
  })

  it('never emits a pip count outside 1-5 across the whole 0-14 range', () => {
    for (let stars = 1; stars <= 14; stars += 1) {
      const band = getStarTier(stars)
      expect(band).not.toBeNull()
      expect(band?.count).toBeGreaterThanOrEqual(1)
      expect(band?.count).toBeLessThanOrEqual(5)
    }
  })
})
