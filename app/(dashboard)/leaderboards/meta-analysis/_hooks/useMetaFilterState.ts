'use client'

import { useEffect, useState } from 'react'
import type { Rarity } from '@/app/lib/config'
import type { BossComparisonStates } from '../_types'

export interface MetaFilterState {
  season: string
  setSeason: (value: string) => void
  selectedRarities: Rarity[]
  setSelectedRarities: (value: Rarity[]) => void
  levelFilter: string
  setLevelFilter: (value: string) => void
  selectedMetaTeams: Set<string>
  setSelectedMetaTeams: React.Dispatch<React.SetStateAction<Set<string>>>
  availableMetaTeams: string[]
  setAvailableMetaTeams: React.Dispatch<React.SetStateAction<string[]>>
  availableLevels: string[]
  setAvailableLevels: React.Dispatch<React.SetStateAction<string[]>>
  bossComparisonStates: BossComparisonStates
  setBossComparisonStates: React.Dispatch<
    React.SetStateAction<BossComparisonStates>
  >
}

export function useMetaFilterState(initialSeason: string): MetaFilterState {
  const [season, setSeason] = useState(initialSeason)
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([
    'Legendary',
    'Mythic'
  ])
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [selectedMetaTeams, setSelectedMetaTeams] = useState<Set<string>>(
    new Set()
  )
  const [availableMetaTeams, setAvailableMetaTeams] = useState<string[]>([])
  const [availableLevels, setAvailableLevels] = useState<string[]>([])
  const [bossComparisonStates, setBossComparisonStates] =
    useState<BossComparisonStates>({})

  useEffect(() => {
    setSeason(initialSeason)
  }, [initialSeason])

  return {
    season,
    setSeason,
    selectedRarities,
    setSelectedRarities,
    levelFilter,
    setLevelFilter,
    selectedMetaTeams,
    setSelectedMetaTeams,
    availableMetaTeams,
    setAvailableMetaTeams,
    availableLevels,
    setAvailableLevels,
    bossComparisonStates,
    setBossComparisonStates
  }
}
