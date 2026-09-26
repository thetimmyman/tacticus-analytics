import type { BossStatDetail } from '@/app/components/playerstats/types'
import { describe, expect, it } from 'vitest'
import { resolveBossKey } from '@/app/components/playerstats/utils/normalization'

const baseDetail: BossStatDetail = {
  damage: 0,
  tokens: 0,
  avgDamage: 0,
  biggestHit: 0,
  vsClusterAvg: 0,
  vsGuildAvg: 0,
  crashes: 0,
  sweeps: 0,
  oneShots: 0,
  totalTokens: 0,
  totalDamageWithSweeps: 0,
  avgDamageWithSweeps: 0
}

describe('resolveBossKey', () => {
  it('returns undefined when the collection is missing', () => {
    expect(resolveBossKey(undefined, 'boss')).toBeUndefined()
  })

  it('returns the exact key when present', () => {
    const collection: Record<string, BossStatDetail> = {
      Boss_One: baseDetail
    }

    expect(resolveBossKey(collection, 'Boss_One')).toBe('Boss_One')
  })

  it('matches by normalized boss name prefix', () => {
    const collection: Record<string, BossStatDetail> = {
      Belisarius_1: baseDetail
    }

    expect(resolveBossKey(collection, 'Belisarius')).toBe('Belisarius_1')
  })
})
