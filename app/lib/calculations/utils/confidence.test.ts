import { describe, it, expect } from 'vitest'
import {
  classifyConfidence,
  hasSufficientAttacks,
  MIN_ATTACKS_FOR_VERDICT,
  MED_CONF_ATTACKS,
  HIGH_CONF_ATTACKS
} from '@/app/lib/calculations/utils/confidence'

describe('classifyConfidence', () => {
  it('low below the medium floor', () => {
    expect(classifyConfidence(0)).toBe('low')
    expect(classifyConfidence(1)).toBe('low')
    expect(classifyConfidence(2)).toBe('low')
  })
  it('medium between the floors', () => {
    expect(classifyConfidence(3)).toBe('medium')
    expect(classifyConfidence(5)).toBe('medium')
  })
  it('high at/above the high floor', () => {
    expect(classifyConfidence(6)).toBe('high')
    expect(classifyConfidence(100)).toBe('high')
  })
  it('constants are ordered', () => {
    expect(MED_CONF_ATTACKS).toBeGreaterThanOrEqual(MIN_ATTACKS_FOR_VERDICT)
    expect(HIGH_CONF_ATTACKS).toBeGreaterThan(MED_CONF_ATTACKS)
  })
})

describe('hasSufficientAttacks', () => {
  it('false below the verdict floor', () => {
    expect(hasSufficientAttacks(0)).toBe(false)
    expect(hasSufficientAttacks(1)).toBe(false)
    expect(hasSufficientAttacks(null)).toBe(false)
    expect(hasSufficientAttacks(undefined)).toBe(false)
  })
  it('true at/above the floor', () => {
    expect(hasSufficientAttacks(MIN_ATTACKS_FOR_VERDICT)).toBe(true)
    expect(hasSufficientAttacks(2)).toBe(true)
    expect(hasSufficientAttacks(10)).toBe(true)
  })
})
