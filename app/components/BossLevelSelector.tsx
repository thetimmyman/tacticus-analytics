'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  RadixTabs,
  RadixTabsList,
  RadixTabsTrigger
} from '@tacticus/ui-kit/radix-tabs'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useDataContext } from '@/app/lib/hooks/useDataContext'
import {
  getRarityPrefix,
  normalizeRarity,
  RARITY_HIERARCHY
} from '@tacticus/app-core/rarity-utils'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import { SinglePassStageFilter } from '@/app/components/filters/SinglePassStageFilter'
import {
  filterToLoopWindow,
  toLoopObservations
} from '@/app/lib/boss-assignments/loop-window'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.BossLevelSelector')

interface BossLevelSelectorProps {
  selectedLevel: string
  selectedSeason?: string
  initialRarities?: Rarity[]
}

interface LevelInfo {
  code: string
  name: string
  fullName: string
  rarity: string
  bossNames: string[]
}

const FALLBACK_LEVELS: LevelInfo[] = [
  {
    code: 'M1',
    name: 'M1',
    fullName: 'Mythic 1 Bosses',
    rarity: 'Mythic',
    bossNames: []
  },
  {
    code: 'L5',
    name: 'L5',
    fullName: 'Level 5 Bosses',
    rarity: 'Legendary',
    bossNames: []
  },
  {
    code: 'L4',
    name: 'L4',
    fullName: 'Level 4 Bosses',
    rarity: 'Legendary',
    bossNames: []
  },
  {
    code: 'L3',
    name: 'L3',
    fullName: 'Level 3 Bosses',
    rarity: 'Legendary',
    bossNames: []
  },
  {
    code: 'L2',
    name: 'L2',
    fullName: 'Level 2 Bosses',
    rarity: 'Legendary',
    bossNames: []
  },
  {
    code: 'L1',
    name: 'L1',
    fullName: 'Level 1 Bosses',
    rarity: 'Legendary',
    bossNames: []
  }
]

const FALLBACK_RARITIES: Rarity[] = ['Mythic', 'Legendary']

const orderRarities = (rarities: Rarity[]): Rarity[] =>
  RARITY_HIERARCHY.filter((rarity) => rarities.includes(rarity)) as Rarity[]

const LEVEL_ORDER = (() => {
  const levels: string[] = []
  const setLevels = [5, 4, 3, 2, 1]
  for (const rarity of RARITY_HIERARCHY) {
    const prefix = getRarityPrefix(rarity)
    setLevels.forEach((level) => levels.push(`${prefix}${level}`))
  }
  return levels
})()

const arraysEqual = (a: Rarity[], b: Rarity[]): boolean => {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

const deriveDefaultRarities = (rarities: Rarity[]): Rarity[] => {
  const ordered = orderRarities(rarities)
  if (ordered.length >= 2) return ordered.slice(0, 2)
  if (ordered.length === 1) return ordered
  return FALLBACK_RARITIES
}

export default function BossLevelSelector({
  selectedLevel,
  selectedSeason,
  initialRarities
}: BossLevelSelectorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const { context } = useDataContext()
  const [availableLevels, setAvailableLevels] = useState<LevelInfo[]>([])
  // Levels below the loop window, kept so the pill can restore them.
  const [singlePassLevels, setSinglePassLevels] = useState<LevelInfo[]>([])
  const [includeSinglePass, setIncludeSinglePass] = useState(false)
  const [availableRarities, setAvailableRarities] = useState<Rarity[]>([])
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>(() => {
    if (initialRarities && initialRarities.length > 0) {
      return orderRarities(initialRarities)
    }
    return []
  })

  const updateQueryParams = useCallback(
    (
      updates: { level?: string; rarity?: Rarity[] | null },
      options: { replace?: boolean } = {}
    ) => {
      const params = new URLSearchParams(searchParamsString)
      const currentQuery = searchParamsString

      if (updates.level !== undefined) {
        if (updates.level) {
          params.set('level', updates.level)
        } else {
          params.delete('level')
        }
      }

      if (updates.rarity !== undefined) {
        const value = updates.rarity
        if (value && value.length > 0) {
          params.set('rarity', value.join(','))
        } else {
          params.delete('rarity')
        }
        params.delete('rarities')
      }

      const nextQuery = params.toString()
      if (nextQuery !== currentQuery) {
        if (options.replace === false) {
          router.push(`/boss?${nextQuery}`, { scroll: false })
        } else {
          router.replace(`/boss?${nextQuery}`, { scroll: false })
        }
      }
    },
    [router, searchParamsString]
  )

  useEffect(() => {
    const fetchAvailableLevels = async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      const supabase = dbClient()

      let seasonToQuery = selectedSeason
      if (!seasonToQuery) {
        // Use season_num (numeric), not "Season" (TEXT), which lex-sorts.
        const { data: latestSeasonData } = await supabase
          .from('EOT_GR_data')
          .select('Season')
          .order('season_num', { ascending: false })
          .limit(1)
        seasonToQuery = String(latestSeasonData?.[0]?.Season ?? 83)
      }

      let query = supabase
        .from('EOT_GR_data')
        .select('rarity, set, Name, loopIndex, Guild')
        .eq('Season', seasonToQuery)
        .order('startedOn', { ascending: false })

      if (context.clusterCode) {
        query = query.eq('cluster_code', context.clusterCode)
      } else if (context.guildCode) {
        query = query.eq('Guild', context.guildCode)
      }

      const { data, error } = await query
      if (error) {
        logger.error({ error }, 'Failed to load boss levels')
      }

      if (!data || data.length === 0) {
        const fallbackLevels = FALLBACK_LEVELS.map((level) => ({ ...level }))
        const allowableInitial = initialRarities
          ? orderRarities(initialRarities).filter((rarity) =>
              FALLBACK_RARITIES.includes(rarity)
            )
          : []
        const fallbackSelection =
          allowableInitial.length > 0
            ? allowableInitial
            : [...FALLBACK_RARITIES]

        setAvailableLevels(fallbackLevels)
        setSinglePassLevels([])
        setIncludeSinglePass(false)
        setAvailableRarities([...FALLBACK_RARITIES])
        setSelectedRarities(fallbackSelection)
        updateQueryParams({ rarity: fallbackSelection })
        return
      }

      const levelSet = new Set<string>()
      const levelMap = new Map<
        string,
        { rarity: string; set: number; bossNames: Set<string> }
      >()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.forEach((item: any) => {
        if (item.rarity && item.set !== null && item.set !== undefined) {
          const normalizedRarity = normalizeRarity(item.rarity)
          const prefix = normalizedRarity
            ? getRarityPrefix(normalizedRarity)
            : 'L'
          const levelCode = `${prefix}${(item.set ?? 0) + 1}`
          levelSet.add(levelCode)

          const existing = levelMap.get(levelCode)
          if (existing) {
            if (item.Name && typeof item.Name === 'string') {
              existing.bossNames.add(item.Name)
            }
          } else {
            const bossNames = new Set<string>()
            if (item.Name && typeof item.Name === 'string') {
              bossNames.add(item.Name)
            }
            levelMap.set(levelCode, {
              rarity: item.rarity,
              set: item.set ?? 0,
              bossNames
            })
          }
        }
      })

      const unsortedLevels = Array.from(levelSet).map((code) => {
        const info = levelMap.get(code)!
        const isMythic = normalizeRarity(info.rarity) === 'Mythic'
        const levelNum = (info.set ?? 0) + 1
        const bossNames = Array.from(info.bossNames).sort()

        return {
          code,
          name: code,
          fullName: isMythic
            ? `Mythic ${levelNum} Bosses`
            : `Level ${levelNum} Bosses`,
          rarity: info.rarity,
          bossNames
        }
      })

      const sortedLevels = unsortedLevels.sort((a, b) => {
        const aIndex = LEVEL_ORDER.indexOf(a.code)
        const bIndex = LEVEL_ORDER.indexOf(b.code)
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex
        }
        if (aIndex !== -1) return -1
        if (bIndex !== -1) return 1

        const normalizedA = normalizeRarity(a.rarity)
        const normalizedB = normalizeRarity(b.rarity)
        if (normalizedA && normalizedB && normalizedA !== normalizedB) {
          return (
            RARITY_HIERARCHY.indexOf(normalizedA) -
            RARITY_HIERARCHY.indexOf(normalizedB)
          )
        }

        const setA = levelMap.get(a.code)?.set ?? 0
        const setB = levelMap.get(b.code)?.set ?? 0
        if (setA !== setB) return setB - setA

        return a.code.localeCompare(b.code)
      })

      // Drop stages this scope never replays once the guild completed a loop. The full ladder
      // stays in state and is trimmed at render, so the "single pass" pill needs no refetch.
      const levels = filterToLoopWindow(
        sortedLevels,
        (level) => level.code,
        toLoopObservations(
          data as Array<{
            rarity?: string | null
            set?: number | null
            loopIndex?: number | null
            Guild?: string | null
          }>
        )
      )
      const singlePass = sortedLevels.filter(
        (level) => !levels.some((kept) => kept.code === level.code)
      )

      const uniqueRarities = Array.from(
        new Set(
          levels
            .map((level) => normalizeRarity(level.rarity))
            .filter((rarity): rarity is Rarity => Boolean(rarity))
        )
      ) as Rarity[]

      const sanitizedInitial = initialRarities
        ? orderRarities(initialRarities).filter((rarity) =>
            uniqueRarities.includes(rarity)
          )
        : []
      const defaults = deriveDefaultRarities(uniqueRarities)
      const nextSelection =
        sanitizedInitial.length > 0 ? sanitizedInitial : defaults
      const paramsForDefaults = new URLSearchParams(searchParamsString)
      const hadRarityParam = Boolean(
        paramsForDefaults.get('rarity') ?? paramsForDefaults.get('rarities')
      )

      setAvailableLevels(levels)
      setSinglePassLevels(singlePass)
      setAvailableRarities(uniqueRarities)
      setSelectedRarities(nextSelection)

      if (sanitizedInitial.length > 0 || hadRarityParam) {
        updateQueryParams({ rarity: nextSelection })
      }
    }

    fetchAvailableLevels()
  }, [
    context.clusterCode,
    context.guildCode,
    initialRarities,
    selectedSeason,
    updateQueryParams,
    searchParamsString
  ])

  const rarityDefaults = useMemo(
    () => deriveDefaultRarities(availableRarities),
    [availableRarities]
  )

  // Re-insert in ladder order so revealing them cannot scramble the tabs.
  const loopVisibleLevels = useMemo(() => {
    if (!includeSinglePass || singlePassLevels.length === 0) {
      return availableLevels
    }
    return [...availableLevels, ...singlePassLevels].sort(
      (a, b) => LEVEL_ORDER.indexOf(a.code) - LEVEL_ORDER.indexOf(b.code)
    )
  }, [availableLevels, includeSinglePass, singlePassLevels])

  const filteredLevels = useMemo(() => {
    if (selectedRarities.length === 0) return loopVisibleLevels
    return loopVisibleLevels.filter((level) => {
      const rarity = normalizeRarity(level.rarity)
      return Boolean(rarity && selectedRarities.includes(rarity))
    })
  }, [loopVisibleLevels, selectedRarities])

  const handleRaritySelection = useCallback(
    (next: Rarity[]) => {
      const normalizedSelection = orderRarities(Array.from(new Set(next)))
      const nextSelection =
        normalizedSelection.length > 0 ? normalizedSelection : rarityDefaults

      if (arraysEqual(nextSelection, selectedRarities)) {
        return
      }

      setSelectedRarities(nextSelection)
      updateQueryParams({ rarity: nextSelection })
    },
    [rarityDefaults, selectedRarities, updateQueryParams]
  )

  useEffect(() => {
    if (availableLevels.length === 0) return
    const candidateLevels =
      filteredLevels.length > 0 ? filteredLevels : loopVisibleLevels
    const currentLevel = loopVisibleLevels.find(
      (level) => level.code === selectedLevel
    )
    const currentRarity = currentLevel
      ? (normalizeRarity(currentLevel.rarity) as Rarity)
      : null

    if (
      !currentLevel ||
      (selectedRarities.length > 0 &&
        (!currentRarity || !selectedRarities.includes(currentRarity)))
    ) {
      const fallback = candidateLevels[0]
      if (fallback && fallback.code !== selectedLevel) {
        updateQueryParams({ level: fallback.code, rarity: selectedRarities })
      }
    }
  }, [
    availableLevels,
    loopVisibleLevels,
    filteredLevels,
    selectedRarities,
    selectedLevel,
    updateQueryParams
  ])

  const handleLevelChange = (levelCode: string) => {
    updateQueryParams(
      { level: levelCode, rarity: selectedRarities },
      { replace: false }
    )
  }

  const displayedLevels =
    filteredLevels.length > 0 ? filteredLevels : loopVisibleLevels

  return (
    <div className="w-full">
      <div className="mb-2 sm:mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <RarityFilterControls
          availableRarities={availableRarities}
          selectedRarities={selectedRarities}
          defaultRarities={rarityDefaults}
          onChange={handleRaritySelection}
          hideIfSingle={false}
          label="Rarity"
        />
        <SinglePassStageFilter
          singlePassStages={singlePassLevels.map((level) => level.code)}
          included={includeSinglePass}
          onChange={setIncludeSinglePass}
        />
      </div>

      <RadixTabs value={selectedLevel} onValueChange={handleLevelChange}>
        <RadixTabsList
          className={`grid w-full ${displayedLevels.length <= 6 ? `grid-cols-2 sm:grid-cols-${displayedLevels.length === 0 ? 1 : Math.min(displayedLevels.length, 3)} md:grid-cols-${displayedLevels.length === 0 ? 1 : displayedLevels.length}` : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6'} gap-1 sm:gap-1.5 h-auto p-1.5 sm:p-2`}
        >
          {displayedLevels.map((level) => {
            const isMythic = normalizeRarity(level.rarity) === 'Mythic'
            const fullTitle =
              level.bossNames.length > 0
                ? `${level.fullName}: ${level.bossNames.join(', ')}`
                : level.fullName

            return (
              <RadixTabsTrigger
                key={level.code}
                value={level.code}
                title={fullTitle}
                className={`
                  px-3 py-2 text-sm font-semibold min-h-[2.5rem] relative overflow-hidden transition-all flex items-center justify-center
                  !bg-transparent hover:!bg-transparent data-[state=active]:!bg-transparent
                  ${
                    isMythic
                      ? `text-orange-200 hover:text-orange-100
                     border border-transparent
                     hover:border-orange-600/40
                     data-[state=active]:!bg-gradient-to-br data-[state=active]:!from-[rgba(30,15,10,0.9)] data-[state=active]:!to-[rgba(40,20,15,0.8)]
                     data-[state=active]:border-2 data-[state=active]:border-orange-500
                     data-[state=active]:shadow-[0_0_20px_rgba(255,140,0,0.5),inset_0_0_12px_rgba(255,195,0,0.2)]
                     data-[state=active]:!text-orange-100`
                      : `text-cyan-200 hover:text-cyan-100
                     border border-transparent
                     hover:border-cyan-600/40
                     data-[state=active]:!bg-gradient-to-br data-[state=active]:!from-[rgba(20,20,25,0.9)] data-[state=active]:!to-[rgba(30,30,35,0.8)]
                     data-[state=active]:border-2 data-[state=active]:border-cyan-400
                     data-[state=active]:shadow-[0_0_20px_rgba(196,181,253,0.4),inset_0_0_10px_rgba(255,255,255,0.15)]
                     data-[state=active]:!text-cyan-100`
                  }
                `}
              >
                <span className="relative z-10 font-bold tracking-wider">
                  {level.name}
                </span>
              </RadixTabsTrigger>
            )
          })}
        </RadixTabsList>
      </RadixTabs>
    </div>
  )
}
