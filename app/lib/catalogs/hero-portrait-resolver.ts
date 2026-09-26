import type { HeroCatalog } from './heroes'
import type { CatalogHero } from './types'

export interface PortraitResolution {
  hero: CatalogHero | null
  portraitUrl: string
  displayName: string
  fallbackBadge: string
}

export function extractBadge(name: string): string {
  const trimmed = name.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const first = words[0]?.charAt(0) ?? ''
    const second = words[1]?.charAt(0) ?? ''
    return (first + second).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

/** `catalog` is required-but-nullable (loading) so callers cannot silently omit it. */
export function resolveHeroPortrait(
  input: string | null | undefined,
  catalog: HeroCatalog | null | undefined
): PortraitResolution {
  if (!input || !catalog) {
    return {
      hero: null,
      portraitUrl: '',
      displayName: input || '',
      fallbackBadge: input ? extractBadge(input) : ''
    }
  }

  const hero =
    catalog.getById(input) ??
    catalog.getByNativeId(input) ??
    catalog.getByName(input)

  const displayName = hero?.displayName?.trim() || input
  return {
    hero,
    portraitUrl: hero?.portraitUrl || hero?.iconUrl || '',
    displayName,
    fallbackBadge: extractBadge(displayName)
  }
}
