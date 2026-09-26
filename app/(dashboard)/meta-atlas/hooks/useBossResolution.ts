'use client'

import { useCallback, useMemo } from 'react'
import { normalizeBossKey } from '@/app/lib/utils/bossNames'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type { Boss } from '@/app/lib/hooks/shared'
import type { CurrentSeasonBoss } from '../types'

type BossLookup = {
  displayName: string
  unitId?: string
}

const normalizeKey = (value?: string | null) =>
  value ? normalizeBossKey(value) : ''

export function useBossResolution(bosses: Boss[]) {
  const bossLookup = useMemo(() => {
    const map = new Map<string, BossLookup>()
    const addKey = (value: string | null | undefined, payload: BossLookup) => {
      const key = normalizeKey(value)
      if (!key) return
      if (!map.has(key)) {
        map.set(key, payload)
      }
    }

    bosses.forEach((boss) => {
      const displayName = boss.displayName || boss.bossType || boss.bossId
      const payload: BossLookup = {
        displayName,
        unitId: boss.unitId
      }

      addKey(boss.bossType, payload)
      addKey(boss.displayName, payload)
      addKey(boss.bossId, payload)
      addKey(boss.unitId ?? null, payload)

      boss.primes?.forEach((prime) => {
        addKey(prime.displayName, payload)
        addKey(prime.bossId, payload)
      })
    })

    return map
  }, [bosses])

  const resolveBoss = useCallback(
    (
      bossType: string,
      bossName?: string,
      bossUnitId?: string
    ): CurrentSeasonBoss => {
      const resolved =
        (bossUnitId ? bossLookup.get(normalizeKey(bossUnitId)) : null) ||
        bossLookup.get(normalizeKey(bossType)) ||
        (bossName ? bossLookup.get(normalizeKey(bossName)) : null) ||
        null

      const normalizedType = normalizeBossKey(bossType)
      const normalizedName = normalizeBossKey(bossName || '')
      const displayName =
        resolved?.displayName || bossName || getBossDisplayName(bossType)

      return {
        boss_type: bossType,
        boss_name: displayName,
        boss_unit_id: bossUnitId || resolved?.unitId,
        canonical: normalizedType || normalizedName || bossType.toLowerCase()
      }
    },
    [bossLookup]
  )

  return { resolveBoss }
}
