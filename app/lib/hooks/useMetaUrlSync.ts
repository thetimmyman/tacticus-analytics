'use client'

import { useEffect, useMemo, useRef, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type MetaUrlSyncState = {
  raritySets: Set<string>
  metaTeams: Set<string>
  bossFilter: string
  showAllBosses: boolean
  allRaritySets?: readonly string[]
  /** Undefined preserves the URL's season; a value equal to implicitSeason is removed. */
  season?: string
  implicitSeason?: string | null
  /** Mirrored as `?tab=` so shared links open the same tab; omitted when it equals defaultTabId. */
  activeTab?: string
  defaultTabId?: string
}

export function useMetaUrlSync(state: MetaUrlSyncState) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const lastSyncRef = useRef<{ from: string; to: string } | null>(null)

  const nextQuery = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    const raritySets = state.raritySets
    const metaTeams = state.metaTeams
    const bossFilter = state.bossFilter.trim()

    const isDefaultRaritySelection =
      state.allRaritySets !== undefined &&
      raritySets.size === state.allRaritySets.length &&
      state.allRaritySets.every((raritySet) => raritySets.has(raritySet))
    const includeRarityParam = raritySets.size > 0 && !isDefaultRaritySelection
    const rarityStr = includeRarityParam ? Array.from(raritySets).join(',') : ''

    if (rarityStr) {
      params.set('rarity', rarityStr)
    } else {
      params.delete('rarity')
    }

    if (metaTeams.size > 0) {
      params.set('teams', Array.from(metaTeams).join(','))
    } else {
      params.delete('teams')
    }

    if (bossFilter) {
      params.set('boss', bossFilter)
    } else {
      params.delete('boss')
    }

    if (state.showAllBosses) {
      params.set('all', 'true')
    } else {
      params.delete('all')
    }

    if (state.season !== undefined) {
      if (state.season && state.season !== state.implicitSeason) {
        params.set('season', state.season)
      } else {
        params.delete('season')
      }
    }

    if (state.activeTab && state.activeTab !== state.defaultTabId) {
      params.set('tab', state.activeTab)
    } else {
      params.delete('tab')
    }

    return params.toString()
  }, [
    searchParams,
    state.activeTab,
    state.allRaritySets,
    state.bossFilter,
    state.implicitSeason,
    state.defaultTabId,
    state.metaTeams,
    state.raritySets,
    state.season,
    state.showAllBosses
  ])

  useEffect(() => {
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) {
      lastSyncRef.current = null
      return
    }

    const lastSync = lastSyncRef.current
    if (lastSync?.from === currentQuery && lastSync.to === nextQuery) return

    lastSyncRef.current = { from: currentQuery, to: nextQuery }
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname
    startTransition(() => {
      router.replace(nextUrl, { scroll: false })
    })
  }, [nextQuery, pathname, router, searchParams, startTransition])

  return { isPending }
}
