'use client'

import { useMemo } from 'react'
import { useHeroCatalog } from '@/app/lib/catalogs'
import type { HeroMapping } from '../utils/roster-helpers'

/** Keyed by unit_id and lowercased display_name; only heroes with a usable icon. */
export function useHeroMappings(): Map<string, HeroMapping> {
  const { data: catalog } = useHeroCatalog()

  return useMemo(() => {
    const map = new Map<string, HeroMapping>()
    if (!catalog) return map
    catalog.getAll().forEach((hero) => {
      if (!hero.iconUrl) return
      const mapping: HeroMapping = {
        unit_id: hero.unitId,
        display_name: hero.displayName,
        web_icon_url: hero.iconUrl
      }
      map.set(hero.unitId, mapping)
      map.set(hero.displayName.toLowerCase(), mapping)
    })
    return map
  }, [catalog])
}
