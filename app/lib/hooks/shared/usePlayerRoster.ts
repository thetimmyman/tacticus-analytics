import { useMemo } from 'react'
import { useBaseQuery } from './useBaseQuery'
import type { MachineOfWar, RosterHero } from './types'

type RosterResponse = {
  units?: unknown
  machinesOfWar?: unknown
  error?: { message?: string; code?: string | number } | string
  code?: string
}

type TokenizedUnit = { id?: unknown; engineId?: unknown; category?: unknown }

type RosterData = {
  heroes: RosterHero[]
  machinesOfWar: MachineOfWar[]
}

const normalizeRosterUnits = (value: unknown): RosterHero[] => {
  if (!Array.isArray(value)) return []

  return value.filter((unit): unit is RosterHero => {
    if (!unit || typeof unit !== 'object') return false
    const id = (unit as TokenizedUnit).id
    return typeof id === 'string' && id.trim().length > 0
  })
}

const mergeById = <T extends RosterHero>(items: T[]): T[] => {
  const seen = new Set<string>()
  const merged: T[] = []

  items.forEach((unit) => {
    const id =
      typeof unit.engineId === 'string' && unit.engineId.trim().length > 0
        ? unit.engineId
        : unit.id
    if (!id || seen.has(id)) return
    seen.add(id)
    merged.push(unit)
  })

  return merged
}

const fetchRoster = async (): Promise<RosterResponse> => {
  const response = await fetch('/api/player/roster')
  const payload = (await response
    .json()
    .catch(() => null)) as RosterResponse | null

  if (!response.ok) {
    const rawError = payload?.error
    const message =
      (typeof rawError === 'object' && rawError !== null
        ? rawError.message
        : typeof rawError === 'string'
          ? rawError
          : undefined) || 'Failed to fetch roster'
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid roster response')
  }

  return payload
}

export function usePlayerRoster(enabled = true) {
  const query = useBaseQuery({
    queryKey: ['player-roster'],
    queryFn: fetchRoster,
    cacheDuration: 5 * 60 * 1000,
    retryCount: 1,
    enabled
  })

  const roster = useMemo<RosterData>(() => {
    if (!query.data) {
      return { heroes: [], machinesOfWar: [] }
    }

    const units = normalizeRosterUnits(query.data.units)
    const machinesOfWar = normalizeRosterUnits(query.data.machinesOfWar)

    const heroUnits = units.filter((unit) => unit.category !== 'mow')
    const mowUnits = units.filter((unit) => unit.category === 'mow')

    return {
      heroes: heroUnits,
      machinesOfWar: mergeById([...machinesOfWar, ...mowUnits])
    }
  }, [query.data])

  const heroIndex = useMemo(() => {
    const index = new Map<string, RosterHero>()
    roster.heroes.forEach((hero) => {
      index.set(hero.id, hero)
      if (hero.engineId) {
        index.set(hero.engineId, hero)
      }
    })
    return index
  }, [roster.heroes])

  return {
    heroes: roster.heroes,
    machinesOfWar: roster.machinesOfWar,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    getHeroById: (unitId: string) => heroIndex.get(unitId)
  }
}
