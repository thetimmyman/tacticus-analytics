'use client'

import { useCallback, useMemo } from 'react'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { usePlayerRoster } from '@/app/lib/hooks/shared'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import {
  normalizeHeroKey,
  resolveHeroMapping,
  type HeroMapping
} from '../utils/hero-mapping'

type HeroMappings = Map<string, HeroMapping>

export function useRosterContext(options: { rosterEnabled?: boolean } = {}) {
  const { data: heroCatalog } = useHeroCatalog()
  const rosterQuery = usePlayerRoster(options.rosterEnabled ?? true)

  const toNumber = useCallback((value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return null
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  }, [])

  const resolveProgressionIndex = useCallback(
    (unit: { progressionIndex?: unknown; rarity?: unknown }) => {
      const direct = toNumber(unit.progressionIndex)
      if (direct != null) return direct
      const rarityRaw =
        typeof unit.rarity === 'string' ? unit.rarity.trim().toLowerCase() : ''
      if (!rarityRaw) return null
      const rarityMap: Record<string, number> = {
        common: 0,
        uncommon: 3,
        rare: 6,
        epic: 9,
        legendary: 12,
        mythic: 16
      }
      return rarityMap[rarityRaw] ?? null
    },
    [toNumber]
  )

  const heroMappings: HeroMappings = useMemo(() => {
    const map = new Map<string, HeroMapping>()
    const heroes = heroCatalog?.getAll() ?? []
    const addMapping = (
      key: string,
      entry: HeroMapping,
      allowOverride = false
    ) => {
      if (!key) return
      const rawKey = key.trim()
      if (!rawKey) return
      const lowerKey = rawKey.toLowerCase()
      const normalizedKey = normalizeHeroKey(rawKey)
      if (allowOverride || !map.has(rawKey)) map.set(rawKey, entry)
      if (allowOverride || !map.has(lowerKey)) map.set(lowerKey, entry)
      if (normalizedKey && (allowOverride || !map.has(normalizedKey))) {
        map.set(normalizedKey, entry)
      }
    }
    heroes.forEach((hero) => {
      const entry = {
        unit_id: hero.unitId,
        display_name: hero.displayName,
        web_icon_url: hero.iconUrl || null
      }
      addMapping(hero.unitId, entry, true)
      addMapping(hero.displayName, entry)
    })
    return map
  }, [heroCatalog])

  const { rosterEntries, rosterNames, rosterSignature, abilityNotice } =
    useMemo(() => {
      const names = new Set<string>()
      const entries: RosterInputEntry[] = []
      const signatureParts: string[] = []
      const rosterUnits = [
        ...rosterQuery.heroes.map((unit) => ({
          ...unit,
          category: unit.category ?? 'hero'
        })),
        ...rosterQuery.machinesOfWar.map((unit) => ({
          ...unit,
          category: 'mow'
        }))
      ]
      let abilitiesFromList = 0
      let abilitiesFromLegacy = 0
      let abilitiesMissing = 0

      rosterUnits.forEach((unit) => {
        const unitId = unit.engineId || unit.id
        const mapping =
          (unit.id ? resolveHeroMapping(unit.id, heroMappings) : null) ??
          (unit.engineId
            ? resolveHeroMapping(unit.engineId, heroMappings)
            : null)
        const displayName = mapping?.display_name || unit.name || unitId
        if (!displayName) return
        const isMow = unit.category === 'mow'
        const rawStarLevel =
          (
            unit as {
              starLevel?: unknown
              stars?: unknown
              star?: unknown
              star_level?: unknown
            }
          ).starLevel ??
          (unit as { stars?: unknown }).stars ??
          (unit as { star?: unknown }).star ??
          (unit as { star_level?: unknown }).star_level
        const stars = toNumber(rawStarLevel)
        const progressionIndex = resolveProgressionIndex(unit)
        const xpLevel = toNumber(unit.xpLevel)
        const rank = toNumber(unit.rank)

        const normalizedAbilities = (() => {
          const rawAbilities = Array.isArray(unit.abilities)
            ? unit.abilities
                .map((ability) => ({
                  id: typeof ability.id === 'string' ? ability.id : null,
                  level: toNumber(ability.level)
                }))
                .filter((ability) => ability.level != null)
            : []

          if (rawAbilities.length >= (isMow ? 1 : 2)) {
            abilitiesFromList += 1
            return rawAbilities
          }

          const activeLevel = toNumber(unit.active)
          const passiveLevel = toNumber(unit.passive)
          if (activeLevel != null || passiveLevel != null) {
            abilitiesFromLegacy += 1
            return [
              ...(activeLevel != null
                ? [{ id: 'active', level: activeLevel }]
                : []),
              ...(passiveLevel != null
                ? [{ id: 'passive', level: passiveLevel }]
                : [])
            ]
          }

          const abilityLevelsRaw =
            (unit as { abilityLevels?: unknown }).abilityLevels ??
            (unit as { ability_levels?: unknown }).ability_levels
          if (typeof abilityLevelsRaw === 'string') {
            const parsedLevels = abilityLevelsRaw
              .split(/[^0-9]+/)
              .filter(Boolean)
              .map((value) => toNumber(value))
              .filter((value): value is number => value != null)
            if (parsedLevels.length > 0) {
              abilitiesFromLegacy += 1
              return parsedLevels.map((level, index) => ({
                id: `ability_${index + 1}`,
                level
              }))
            }
          }

          abilitiesMissing += 1
          return null
        })()

        const abilitiesKey = Array.isArray(normalizedAbilities)
          ? normalizedAbilities
              .map((ability) => `${ability.id ?? ''}:${ability.level ?? ''}`)
              .sort()
              .join(',')
          : ''

        names.add(displayName)
        signatureParts.push(
          [
            unit.id,
            unit.engineId ?? '',
            displayName,
            progressionIndex ?? '',
            stars ?? '',
            xpLevel ?? '',
            rank ?? '',
            abilitiesKey
          ].join('|')
        )
        entries.push({
          id: unit.id,
          engineId: unit.engineId ?? null,
          name: displayName,
          progressionIndex,
          stars,
          xpLevel,
          rank,
          abilities: normalizedAbilities,
          category: unit.category ?? null
        })
      })

      signatureParts.sort()
      let resolvedAbilityNotice: string | null = null
      if (rosterUnits.length > 0) {
        if (abilitiesFromList === 0 && abilitiesFromLegacy === 0) {
          resolvedAbilityNotice =
            'Ability levels are missing from the roster payload. The API response did not include abilities or active/passive levels, so strength tiers may be understated.'
        } else if (abilitiesFromList === 0 && abilitiesFromLegacy > 0) {
          resolvedAbilityNotice =
            'Ability levels are missing from the roster payload. The API response only includes active/passive fields, so we map those values for strength checks.'
        } else if (abilitiesMissing > 0) {
          resolvedAbilityNotice = `Ability levels are missing for ${abilitiesMissing} of ${rosterUnits.length} roster units in the payload; those units will be treated as below minimums.`
        } else if (abilitiesFromLegacy > 0) {
          resolvedAbilityNotice =
            'Ability levels were derived from active/passive fields because the roster payload omitted abilities for some units.'
        }
      }

      return {
        rosterEntries: entries,
        rosterNames: Array.from(names),
        rosterSignature: signatureParts.join('||'),
        abilityNotice: resolvedAbilityNotice
      }
    }, [
      rosterQuery.heroes,
      rosterQuery.machinesOfWar,
      heroMappings,
      resolveProgressionIndex,
      toNumber
    ])

  const hasRoster =
    rosterNames.length > 0 && !rosterQuery.isLoading && !rosterQuery.error

  return {
    heroMappings,
    rosterEntries,
    rosterNames,
    rosterSignature,
    rosterQuery,
    abilityNotice,
    hasRoster
  }
}
