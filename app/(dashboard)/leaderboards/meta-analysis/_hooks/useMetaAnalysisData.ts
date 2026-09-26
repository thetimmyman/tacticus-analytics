'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  RecommendedTeam,
  TeamComposition
} from '@tacticus/app-core/meta-analysis.types'
import { useAsyncPerformance } from '@/app/hooks/usePerformance'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.meta-analysis._hooks.useMetaAnalysisData'
)
import type { Rarity } from '@/app/lib/config'
import { RARITY_HIERARCHY } from '@tacticus/app-core/rarity-utils'
import {
  readMetaAnalysisScopedPayload,
  widenMetaAnalysisScope,
  type MetaAnalysisScope
} from '@/app/lib/meta/meta-analysis-scope'
import { MIN_RECOMMENDED_BATTLES } from '../_constants'
import type { BossAnalysis, MetaAnalysisSource } from '../_types'

function readMetaSource(response: Response): MetaAnalysisSource | null {
  const value = response.headers.get('x-meta-source')
  return value === 'meta-atlas-rpc' ||
    value === 'fallback-disabled' ||
    value === 'fallback-error'
    ? value
    : null
}

export interface UseMetaAnalysisDataParams {
  season: string
  selectedRarities: Rarity[]
  setAvailableMetaTeams: Dispatch<SetStateAction<string[]>>
  setAvailableLevels: Dispatch<SetStateAction<string[]>>
}

export interface UseMetaAnalysisDataResult {
  recommendedTeams: RecommendedTeam[]
  bossAnalyses: BossAnalysis[]
  /** Stages the loop no longer replays — hidden by default, not dropped. */
  singlePassStages: string[]
  scope: MetaAnalysisScope | null
  /** `x-meta-source` of the last response, telling genuine empty from a fallback. */
  recommendedSource: MetaAnalysisSource | null
  setBossAnalyses: Dispatch<SetStateAction<BossAnalysis[]>>
  recommendedLoading: boolean
  bossDataLoading: boolean
  loadingProgress: { current: number; total: number }
  error: string | null
  fetchAllData: () => void
}

/** No guild filter: the RPC has no guild parameter, so a filter would only look scoped. */
export function useMetaAnalysisData(
  params: UseMetaAnalysisDataParams
): UseMetaAnalysisDataResult {
  const {
    season,
    selectedRarities,
    setAvailableMetaTeams,
    setAvailableLevels
  } = params

  const { measureAsync } = useAsyncPerformance()

  const [recommendedTeams, setRecommendedTeams] = useState<RecommendedTeam[]>(
    []
  )
  const [bossAnalyses, setBossAnalyses] = useState<BossAnalysis[]>([])
  const [singlePassStages, setSinglePassStages] = useState<string[]>([])
  const [scope, setScope] = useState<MetaAnalysisScope | null>(null)
  const [recommendedSource, setRecommendedSource] =
    useState<MetaAnalysisSource | null>(null)
  const [recommendedLoading, setRecommendedLoading] = useState(true)
  const [bossDataLoading, setBossDataLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState({
    current: 0,
    total: 0
  })
  const [error, setError] = useState<string | null>(null)

  const hasFetchedInitially = useRef(false)
  const lastFetchParams = useRef<string>('')
  const isFetching = useRef(false)

  const noteScope = useCallback((next: MetaAnalysisScope) => {
    setScope((prev) => widenMetaAnalysisScope(prev, next))
  }, [])

  const fetchRecommendedTeams = useCallback(async () => {
    await measureAsync('fetchRecommendedTeams', async () => {
      try {
        const queryParams = new URLSearchParams({
          season,
          rarity: selectedRarities.join(',')
        })
        const response = await fetch(
          `/api/meta-analysis/recommendations?${queryParams}`
        )
        if (!response.ok) throw new Error('Failed to fetch recommended teams')
        setRecommendedSource(readMetaSource(response))
        const payload = readMetaAnalysisScopedPayload<RecommendedTeam>(
          await response.json()
        )
        noteScope(payload.scope)
        const filteredTeams = payload.data.filter(
          (team: RecommendedTeam) =>
            (team.composition?.battlesCount ?? 0) >= MIN_RECOMMENDED_BATTLES
        )

        const allTeams = new Set<string>()
        const allLevels = new Set<string>()

        filteredTeams.forEach((team: RecommendedTeam) => {
          if (
            team.composition?.categories &&
            Array.isArray(team.composition.categories)
          ) {
            team.composition.categories.forEach((cat: string) => {
              if (cat && cat.trim()) allTeams.add(cat.trim())
            })
          }
          if (
            team.composition?.category &&
            typeof team.composition.category === 'string'
          ) {
            const cat = team.composition.category.trim()
            if (cat) allTeams.add(cat)
          }
          if (team.levelString) {
            allLevels.add(team.levelString)
          }
        })

        const metaTeamsList = Array.from(allTeams).sort()
        setAvailableMetaTeams(metaTeamsList)

        const sortedLevels = Array.from(allLevels).sort((a, b) => {
          const aIsMythic = a.startsWith('M')
          const bIsMythic = b.startsWith('M')
          if (aIsMythic && !bIsMythic) return -1
          if (!aIsMythic && bIsMythic) return 1
          const aNum = parseInt(a.substring(1))
          const bNum = parseInt(b.substring(1))
          return bNum - aNum
        })
        setAvailableLevels(sortedLevels)

        const sortedTeams = filteredTeams.sort(
          (a: RecommendedTeam, b: RecommendedTeam) => {
            const aRarityIndex = RARITY_HIERARCHY.indexOf(a.rarity as Rarity)
            const bRarityIndex = RARITY_HIERARCHY.indexOf(b.rarity as Rarity)
            if (aRarityIndex !== bRarityIndex) {
              return aRarityIndex - bRarityIndex
            }
            return b.set - a.set
          }
        )

        setRecommendedTeams(sortedTeams)
      } catch (err) {
        logger.error({ err: err }, 'Error fetching recommended teams:')
      } finally {
        setRecommendedLoading(false)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, selectedRarities, noteScope])

  const fetchBossAnalyses = useCallback(async () => {
    const bossNamesResponse = await fetch(
      `/api/meta-analysis/boss-names?season=${season}&rarity=${selectedRarities.join(',')}`,
      { credentials: 'include' }
    )
    const bossNamesData = await bossNamesResponse.json()

    // Reported, not dropped, so they stay available behind the "single pass" pill.
    setSinglePassStages(
      (bossNamesResponse.headers.get('X-Single-Pass-Stages') ?? '')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean)
    )

    const dynamicBossLevels: Array<{
      rarity: string
      set: number
      levelString: string
      bossName: string
      encounterId: number
      bossType: 'main' | 'side-left' | 'side-right'
    }> = []

    selectedRarities.forEach((rarity) => {
      const rarityPrefix = rarity.charAt(0).toUpperCase()

      for (let set = 0; set <= 4; set++) {
        const mainKey = `${rarity}-${set}`
        const sideKey1 = `${rarity}-${set}-side1`
        const sideKey2 = `${rarity}-${set}-side2`

        if (bossNamesData[mainKey]) {
          dynamicBossLevels.push({
            rarity,
            set,
            levelString: `${rarityPrefix}${set + 1}`,
            bossName: bossNamesData[mainKey],
            encounterId: 0,
            bossType: 'main'
          })

          if (bossNamesData[sideKey1]) {
            dynamicBossLevels.push({
              rarity,
              set,
              levelString: `${rarityPrefix}${set + 1}`,
              bossName: bossNamesData[sideKey1],
              encounterId: 1,
              bossType: 'side-left'
            })
          }

          if (bossNamesData[sideKey2]) {
            dynamicBossLevels.push({
              rarity,
              set,
              levelString: `${rarityPrefix}${set + 1}`,
              bossName: bossNamesData[sideKey2],
              encounterId: 2,
              bossType: 'side-right'
            })
          }
        }
      }
    })

    const levelsToAnalyze = dynamicBossLevels

    if (levelsToAnalyze.length === 0) {
      setBossAnalyses([])
      return
    }

    const uniqueLevels = new Set<string>()
    levelsToAnalyze.forEach((boss) => uniqueLevels.add(boss.levelString))
    const sortedUniqueLevels = Array.from(uniqueLevels).sort((a, b) => {
      const aIsMythic = a.startsWith('M')
      const bIsMythic = b.startsWith('M')
      if (aIsMythic && !bIsMythic) return -1
      if (!aIsMythic && bIsMythic) return 1
      const aNum = parseInt(a.substring(1))
      const bNum = parseInt(b.substring(1))
      return bNum - aNum
    })
    setAvailableLevels((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(sortedUniqueLevels))
        return prev
      return sortedUniqueLevels
    })

    const skeletonAnalyses: BossAnalysis[] = levelsToAnalyze.map((boss) => ({
      rarity: boss.rarity,
      set: boss.set,
      levelString: boss.levelString,
      bossName: boss.bossName,
      encounterId: boss.encounterId,
      bossType: boss.bossType,
      compositions: [],
      loading: true,
      error: null
    }))

    setBossAnalyses(skeletonAnalyses)
    setBossDataLoading(true)
    setLoadingProgress({ current: 0, total: levelsToAnalyze.length })

    const fetchBossData = async (
      boss: (typeof levelsToAnalyze)[0],
      delay: number
    ) => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        const queryParams = new URLSearchParams({
          rarity: boss.rarity,
          set: boss.set.toString(),
          season,
          encounterId: boss.encounterId.toString(),
          minBattles: '3',
          limit: '50'
        })
        const response = await fetch(`/api/meta-analysis?${queryParams}`, {
          credentials: 'include'
        })
        if (!response.ok)
          throw new Error(
            `Failed to fetch ${boss.levelString} ${boss.bossType} data`
          )
        // No single-guild retry on an empty cell: the endpoint is global.
        const cellSource = readMetaSource(response)
        const payload = readMetaAnalysisScopedPayload<TeamComposition>(
          await response.json()
        )
        noteScope(payload.scope)
        const compositions = payload.data

        setBossAnalyses((prev) => {
          const updated = prev.map((analysis) => {
            if (
              analysis.rarity === boss.rarity &&
              analysis.set === boss.set &&
              analysis.encounterId === boss.encounterId
            ) {
              return {
                ...analysis,
                compositions,
                loading: false,
                error: null,
                source: cellSource
              }
            }
            return analysis
          })

          const doneCount = updated.filter((a) => !a.loading).length
          if (doneCount >= prev.length) {
            setTimeout(() => setBossDataLoading(false), 0)
          }
          setTimeout(
            () => setLoadingProgress((p) => ({ ...p, current: doneCount })),
            0
          )

          return updated
        })
      } catch (err) {
        logger.error(
          { err: err },
          `Error analyzing ${boss.levelString} ${boss.bossType}:`
        )
        setBossAnalyses((prev) => {
          const updated = prev.map((analysis) => {
            if (
              analysis.rarity === boss.rarity &&
              analysis.set === boss.set &&
              analysis.encounterId === boss.encounterId
            ) {
              return {
                ...analysis,
                loading: false,
                error: `Failed to load data`
              }
            }
            return analysis
          })

          const doneCount = updated.filter((a) => !a.loading).length
          if (doneCount >= prev.length) {
            setTimeout(() => setBossDataLoading(false), 0)
          }
          setTimeout(
            () => setLoadingProgress((p) => ({ ...p, current: doneCount })),
            0
          )

          return updated
        })
      }
    }

    const sortedLevels = [...levelsToAnalyze].sort((a, b) => {
      const aRarityIndex = RARITY_HIERARCHY.indexOf(a.rarity as Rarity)
      const bRarityIndex = RARITY_HIERARCHY.indexOf(b.rarity as Rarity)
      if (aRarityIndex !== bRarityIndex) {
        return aRarityIndex - bRarityIndex
      }

      if (a.rarity === b.rarity && a.set !== b.set) return b.set - a.set

      return a.encounterId - b.encounterId
    })

    sortedLevels.forEach((boss, index) => {
      const delay = index * 100
      fetchBossData(boss, delay)
    })
  }, [season, selectedRarities, setAvailableLevels, noteScope])

  const fetchAllData = useCallback(() => {
    if (isFetching.current) return
    isFetching.current = true
    setError(null)
    setScope(null)
    setRecommendedSource(null)

    Promise.all([fetchRecommendedTeams(), fetchBossAnalyses()]).finally(() => {
      isFetching.current = false
    })
  }, [fetchRecommendedTeams, fetchBossAnalyses])

  useEffect(() => {
    const fetchParams = `${season}-${selectedRarities.join(',')}`
    if (
      !hasFetchedInitially.current ||
      lastFetchParams.current !== fetchParams
    ) {
      hasFetchedInitially.current = true
      lastFetchParams.current = fetchParams
      fetchAllData()
    }
  }, [season, selectedRarities, fetchAllData])

  return {
    recommendedTeams,
    bossAnalyses,
    singlePassStages,
    scope,
    recommendedSource,
    setBossAnalyses,
    recommendedLoading,
    bossDataLoading,
    loadingProgress,
    error,
    fetchAllData
  }
}
