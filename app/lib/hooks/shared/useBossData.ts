import { useMemo } from 'react'
import { useBossCatalog } from '@/app/lib/catalogs'
import { useSeasonData } from './useSeasonData'
import type { Boss } from './types'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

export interface UseBossDataOptions {
  seasonNumber?: number
  setNumber?: number
  includePortraits?: boolean
}

export interface UseBossDataResult {
  bosses: Boss[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
  getBossById: (id: string) => Boss | undefined
}

const normalizeBossKey = normalizeIdentifier

export function useBossData(
  options: UseBossDataOptions = {}
): UseBossDataResult {
  const bossCatalogQuery = useBossCatalog()
  const shouldLoadSeason = typeof options.seasonNumber === 'number'
  const seasonData = useSeasonData(undefined, { enabled: shouldLoadSeason })

  const seasonBossKeys = useMemo(() => {
    if (!shouldLoadSeason) return null

    const seasonMatch = [
      seasonData.currentSeason,
      seasonData.upcomingSeason
    ].find((season) => season?.seasonNumber === options.seasonNumber)

    if (!seasonMatch) return null

    const keys = new Set<string>()
    seasonMatch.bosses.forEach((boss) => {
      if (boss.boss_type) keys.add(normalizeBossKey(boss.boss_type))
      if (boss.boss_name) keys.add(normalizeBossKey(boss.boss_name))
    })

    return keys
  }, [
    options.seasonNumber,
    seasonData.currentSeason,
    seasonData.upcomingSeason,
    shouldLoadSeason
  ])

  const bosses = useMemo(() => {
    const catalog = bossCatalogQuery.data
    if (!catalog) return []

    let list = catalog.getAll()

    if (typeof options.setNumber === 'number') {
      list = list.filter((boss) => boss.setNumber === options.setNumber)
    }

    if (seasonBossKeys && seasonBossKeys.size > 0) {
      list = list.filter((boss) => {
        const candidates = [boss.bossType, boss.displayName]
          .filter((value): value is string => typeof value === 'string')
          .map(normalizeBossKey)
        return candidates.some((candidate) => seasonBossKeys.has(candidate))
      })
    }

    if (options.includePortraits === false) {
      list = list.map((boss) => ({
        ...boss,
        portraits: {
          icon: '',
          thumbnail: '',
          portrait: ''
        }
      }))
    }

    return list
  }, [
    bossCatalogQuery.data,
    options.includePortraits,
    options.setNumber,
    seasonBossKeys
  ])

  const refetch = async () => {
    await Promise.all([
      bossCatalogQuery.refetch(),
      shouldLoadSeason ? seasonData.refetch() : Promise.resolve()
    ])
  }

  const getBossById = (id: string) => {
    if (!bossCatalogQuery.data) return undefined
    return (
      bossCatalogQuery.data.getById(id) ??
      bossCatalogQuery.data.getByName(id) ??
      undefined
    )
  }

  return {
    bosses,
    isLoading:
      bossCatalogQuery.isLoading || (shouldLoadSeason && seasonData.isLoading),
    error:
      bossCatalogQuery.error ??
      (shouldLoadSeason ? seasonData.error : null) ??
      null,
    refetch,
    getBossById
  }
}
