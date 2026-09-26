// Shared by the catalog and <BossPortrait> so they never pick different images. A Hive Tyrant
// `icons` entry pointing into portraits/ is intentional (pinned by characterization tests).

import { bossPortraitManifest } from '@/app/lib/data/boss-portrait-manifest'
import {
  normalizeBossKey,
  stripNonAlnumLower
} from '@/app/lib/resolvers/boss-identity'
import type { CatalogBossPortraits } from '@/app/lib/catalogs/types'

export const normalizeBossAssetKey = stripNonAlnumLower

/** Separators become `_` (not removed), unlike the boss-identity key normalizers. */
export const normalizeBossSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const MANIFEST_VARIANTS: Record<
  keyof CatalogBossPortraits,
  'icons' | 'portraits' | 'thumbnails'
> = {
  icon: 'icons',
  portrait: 'portraits',
  thumbnail: 'thumbnails'
}

const DEFAULT_BASE_SLUGS: Record<string, string> = {
  tervigon: 'tervigonleviathan_main',
  hivetyrant: 'hivetyrantleviathan_main',
  hive_tyrant: 'hivetyrantleviathan_main',
  screamerkiller: 'screamerkiller_main',
  screamer_killer: 'screamerkiller_main'
}

/** API/engine tokens for primes whose manifest slug is not name-derivable. */
const LOCAL_PORTRAIT_ALIASES: Record<string, string> = {
  deathrotbone: 'mortarion_rotbone',
  guildboss5miniboss1deathrotbone: 'mortarion_rotbone',
  nauseous_rotbone: 'mortarion_rotbone',
  nauseousrotbone: 'mortarion_rotbone',
  blightbringer: 'mortarion_corrodius',
  deathblightbringer: 'mortarion_corrodius',
  guildboss5miniboss2deathblightbringer: 'mortarion_corrodius'
}

export const buildFallbackPath = (
  slug: string,
  variant: keyof CatalogBossPortraits
): string => {
  const root = '/images/bosses'
  switch (variant) {
    case 'icon':
      return `${root}/icons/${slug}.png`
    case 'thumbnail':
      return `${root}/thumbnails/${slug}.png`
    default:
      return `${root}/portraits/${slug}.png`
  }
}

export const resolveManifestVariant = (
  candidates: string[],
  variant: keyof CatalogBossPortraits
): string | null => {
  const manifestVariant = MANIFEST_VARIANTS[variant]
  for (const candidate of candidates) {
    const entry = bossPortraitManifest.bySlug[candidate]
    if (entry?.[manifestVariant]) {
      return entry[manifestVariant]
    }
  }

  for (const candidate of candidates) {
    const aliasEntry = bossPortraitManifest.byAlias?.[candidate]
    if (!aliasEntry) continue
    const slug = Array.isArray(aliasEntry) ? aliasEntry[0] : aliasEntry
    const entry = slug ? bossPortraitManifest.bySlug[slug] : null
    if (entry?.[manifestVariant]) {
      return entry[manifestVariant]
    }
  }

  for (const candidate of candidates) {
    const baseEntry = bossPortraitManifest.byBase?.[candidate]
    if (!baseEntry?.default) continue
    const entry = bossPortraitManifest.bySlug[baseEntry.default]
    if (entry?.[manifestVariant]) {
      return entry[manifestVariant]
    }
  }

  return null
}

const normalizeBossName = (rawName: string) => {
  const normalized = rawName
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, '')
    .trim()

  const withUnderscores = normalized.replace(/[\s-]+/g, '_')
  const compact = withUnderscores.replace(/_/g, '')

  const collapsed = rawName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

  return {
    withUnderscores,
    compact,
    collapsed
  }
}

/** Adds prime aliases, separator-trim retries and DEFAULT_BASE_SLUGS on top of the manifest lookup. */
export const resolveBossAssetPath = (
  bossName: string,
  variant: keyof CatalogBossPortraits
): string | null => {
  const manifestVariant = MANIFEST_VARIANTS[variant]

  const tryNormalized = (
    normalized: ReturnType<typeof normalizeBossName>
  ): string | null => {
    const { withUnderscores, compact, collapsed } = normalized

    const slugCandidates = Array.from(
      new Set(
        [
          withUnderscores,
          compact,
          collapsed,
          `${withUnderscores}_main`,
          `${compact}_main`,
          `${collapsed}_main`
        ].filter(Boolean)
      )
    )

    for (const candidate of slugCandidates) {
      const entry = bossPortraitManifest.bySlug[candidate]
      if (entry?.[manifestVariant]) {
        return entry[manifestVariant]
      }
    }

    const aliasCandidates = Array.from(
      new Set([withUnderscores, compact, collapsed].filter(Boolean))
    )

    for (const aliasCandidate of aliasCandidates) {
      const localAlias = LOCAL_PORTRAIT_ALIASES[aliasCandidate]
      if (localAlias) {
        const entry = bossPortraitManifest.bySlug[localAlias]
        if (entry?.[manifestVariant]) {
          return entry[manifestVariant]
        }
      }

      const aliasEntry = bossPortraitManifest.byAlias?.[aliasCandidate]
      if (!aliasEntry) continue

      const slug = Array.isArray(aliasEntry) ? aliasEntry[0] : aliasEntry
      if (!slug) continue

      const entry = bossPortraitManifest.bySlug[slug]
      if (entry?.[manifestVariant]) {
        return entry[manifestVariant]
      }
    }

    const baseCandidates = Array.from(
      new Set([withUnderscores, compact, collapsed].filter(Boolean))
    )

    for (const baseCandidate of baseCandidates) {
      const baseEntry = bossPortraitManifest.byBase[baseCandidate]
      if (baseEntry) {
        const defaultSlug = baseEntry.default
        const entry = bossPortraitManifest.bySlug[defaultSlug]
        if (entry?.[manifestVariant]) {
          return entry[manifestVariant]
        }
      }
    }

    return null
  }

  const normalizedBossName = normalizeBossName(bossName)
  const primaryMatch = tryNormalized(normalizedBossName)
  if (primaryMatch) return primaryMatch

  const baseTrims = Array.from(
    new Set(
      [
        bossName.split('(')[0]?.trim(),
        bossName.split('-')[0]?.trim(),
        bossName.split('–')[0]?.trim(),
        bossName.split(':')[0]?.trim(),
        bossName.split('|')[0]?.trim(),
        bossName.split('/')[0]?.trim(),
        bossName.split('•')[0]?.trim(),
        bossName.split('Variant')[0]?.trim(),
        bossName.split('Side')[0]?.trim(),
        bossName.split('Encounter')[0]?.trim(),
        bossName.split('Prime')[0]?.trim(),
        bossName.split(/\s+/)[0]
      ]
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  )

  for (const candidate of baseTrims) {
    const match = tryNormalized(normalizeBossName(candidate))
    if (match) return match
  }

  const normalizedKey = normalizeBossKey(bossName) || normalizedBossName.compact
  const fallbackSlug = normalizedKey
    ? DEFAULT_BASE_SLUGS[normalizedKey]
    : undefined
  if (fallbackSlug) {
    const entry = bossPortraitManifest.bySlug[fallbackSlug]
    if (entry?.[manifestVariant]) {
      return entry[manifestVariant]
    }
  }

  return null
}

export interface BossPortraitSource {
  asset_slug?: string | null
  boss_type?: string | null
  boss_name?: string | null
  icon_path?: string | null
  portrait_path?: string | null
  thumbnail_path?: string | null
}

/** Order: manifest variant, DB path, name-based lookup, static fallback. */
export const buildPortraits = (
  row?: BossPortraitSource
): CatalogBossPortraits => {
  const assetSlug = row?.asset_slug?.trim() || ''
  const bossType = row?.boss_type?.trim() || ''
  const bossName = row?.boss_name?.trim() || ''
  const fallbackSlug = normalizeBossSlug(assetSlug || bossType || bossName)
  const baseCandidates = [
    assetSlug,
    normalizeBossSlug(bossType),
    normalizeBossSlug(bossName),
    normalizeBossAssetKey(bossType),
    normalizeBossAssetKey(bossName)
  ].filter(Boolean)

  const candidates = Array.from(
    new Set(
      baseCandidates.flatMap((candidate) => [candidate, `${candidate}_main`])
    )
  )

  // Runs AFTER the row's DB paths: the name engine trims aggressively, so a
  // curated portrait_path must not be overridden by a fuzzy name hit.
  const resolveRich = (variant: keyof CatalogBossPortraits): string | null =>
    (bossType ? resolveBossAssetPath(bossType, variant) : null) ??
    (bossName ? resolveBossAssetPath(bossName, variant) : null)

  const portrait =
    resolveManifestVariant(candidates, 'portrait') ||
    row?.portrait_path ||
    resolveRich('portrait') ||
    buildFallbackPath(fallbackSlug, 'portrait')
  const icon =
    resolveManifestVariant(candidates, 'icon') ||
    row?.icon_path ||
    resolveRich('icon') ||
    buildFallbackPath(fallbackSlug, 'icon')
  const thumbnail =
    resolveManifestVariant(candidates, 'thumbnail') ||
    row?.thumbnail_path ||
    resolveRich('thumbnail') ||
    buildFallbackPath(fallbackSlug, 'thumbnail')

  return {
    icon,
    thumbnail,
    portrait
  }
}
