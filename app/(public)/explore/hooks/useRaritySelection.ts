import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  normalizeRarity,
  sortRaritiesByHierarchy,
  Rarity
} from '@tacticus/app-core/rarity-utils'
import type { GuildData } from '../types'

export function useRaritySelection(guilds: GuildData[]) {
  const [availableRarities, setAvailableRarities] = useState<Rarity[]>([])
  const [defaultRarities, setDefaultRarities] = useState<Rarity[]>([])
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([])
  const hasUserOverrideRef = useRef(false)

  const rarityCounts = useMemo(() => {
    const counts: Partial<Record<Rarity, number>> = {}
    guilds.forEach((g) => {
      const hits = Array.isArray(g.top_boss_hits) ? g.top_boss_hits : []
      hits.forEach((hit) => {
        if (hit && typeof hit === 'object' && 'rarity' in hit) {
          const rarity = normalizeRarity((hit as { rarity?: unknown }).rarity)
          if (rarity) {
            counts[rarity] = (counts[rarity] ?? 0) + 1
          }
        }
      })
    })
    return counts
  }, [guilds])

  useEffect(() => {
    if (guilds.length === 0) {
      setAvailableRarities([])
      setDefaultRarities([])
      if (!hasUserOverrideRef.current) {
        setSelectedRarities([])
      }
      return
    }

    const allRarities = sortRaritiesByHierarchy(
      Array.from(new Set(guilds.flatMap((g) => g.available_rarities)))
    )

    setAvailableRarities(allRarities)

    const defaults = allRarities.slice(0, Math.min(2, allRarities.length))
    setDefaultRarities(defaults)

    if (!hasUserOverrideRef.current) {
      setSelectedRarities(defaults)
    }
  }, [guilds])

  useEffect(() => {
    if (!hasUserOverrideRef.current && defaultRarities.length > 0) {
      setSelectedRarities(defaultRarities)
    }
  }, [defaultRarities])

  const handleRarityChange = useCallback((rarities: Rarity[]) => {
    hasUserOverrideRef.current = true
    setSelectedRarities(rarities)
  }, [])

  const handleRarityReset = useCallback(() => {
    hasUserOverrideRef.current = false
    setSelectedRarities(defaultRarities)
  }, [defaultRarities])

  return {
    selectedRarities,
    defaultRarities,
    availableRarities,
    rarityCounts,
    handleRarityChange,
    handleRarityReset
  }
}
