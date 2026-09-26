import { describe, it, expect } from 'vitest'
import {
  isSweepRow,
  applyQualifyingSweepException,
  type SweepCheckRow
} from '@/app/lib/calculations/utils/sweep-helpers'

const MAX_HP = 10_000
const hit = (damageDealt: number): SweepCheckRow => ({
  damageDealt,
  remainingHp: 500,
  maxHp: MAX_HP
})
// Killing blow on a pre-damaged boss.
const sweep = (damageDealt: number): SweepCheckRow => ({
  damageDealt,
  remainingHp: 0,
  maxHp: MAX_HP
})
const oneShot = (damageDealt: number): SweepCheckRow => ({
  damageDealt,
  remainingHp: 0,
  maxHp: MAX_HP
})

describe('isSweepRow', () => {
  it('true for a killing blow below max HP', () => {
    expect(isSweepRow(sweep(40))).toBe(true)
  })
  it('false for a one-shot (damage >= maxHp)', () => {
    expect(isSweepRow(oneShot(12_000))).toBe(false)
  })
  it('false for a non-killing hit', () => {
    expect(isSweepRow(hit(40))).toBe(false)
  })
})

describe('applyQualifyingSweepException', () => {
  it('drops sweeps below the gate, keeps those at/above (gate = GREATEST(playerAvg, ref))', () => {
    const r = applyQualifyingSweepException(300, 3, [50, 150], 100, 100)
    expect(r).toEqual({ adjustedDamage: 450, adjustedCount: 4 })
  })
  it('gate uses the stronger player avg when it beats the reference', () => {
    const r = applyQualifyingSweepException(400, 2, [150], 100, 200)
    expect(r).toEqual({ adjustedDamage: 400, adjustedCount: 2 })
  })
  it('no sweeps → unchanged', () => {
    expect(applyQualifyingSweepException(300, 3, [], 100)).toEqual({
      adjustedDamage: 300,
      adjustedCount: 3
    })
  })
  it('reference <= 0 → all sweeps dropped (no baseline to qualify against)', () => {
    expect(applyQualifyingSweepException(300, 3, [9999], 0)).toEqual({
      adjustedDamage: 300,
      adjustedCount: 3
    })
  })
})
