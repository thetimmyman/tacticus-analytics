import { describe, expect, it } from 'vitest'
import { resolveBossHpKey } from '@/app/lib/boss-assignments/season-planner/boss-hp'
import {
  BOSS_HP_BY_NAME,
  PRIME_HP_BY_BOSS
} from '@/app/lib/constants/tacticustable-boss-hp'

describe('season planner boss HP key resolution', () => {
  it('resolves LOKI AvatarOfKhaine to tacticustable Avatar', () => {
    expect(resolveBossHpKey('AvatarOfKhaine')).toBe('Avatar')
    expect(resolveBossHpKey('Avatar of Khaine')).toBe('Avatar')
  })

  it('resolves common aliases', () => {
    expect(resolveBossHpKey('BelisariusRW')).toBe('Belisarius')
  })

  it('returns the exact key when the raw name is already a canonical table key', () => {
    // Exact match wins before normalization collapses HiveTyrant/Tervigon variants.
    expect(resolveBossHpKey('HiveTyrantKronos')).toBe('HiveTyrantKronos')
    expect(resolveBossHpKey('HiveTyrantGorgon')).toBe('HiveTyrantGorgon')
    expect(resolveBossHpKey('TervigonLeviathan')).toBe('TervigonLeviathan')
    expect('HiveTyrantKronos' in BOSS_HP_BY_NAME).toBe(true)
    expect('HiveTyrantGorgon' in BOSS_HP_BY_NAME).toBe(true)
  })

  it('returns null (not a passthrough/default) for an UNMAPPED boss_type', () => {
    const unknown = 'GreaterDaemonOfNurgle'
    expect(unknown in BOSS_HP_BY_NAME).toBe(false)
    expect(unknown in PRIME_HP_BY_BOSS).toBe(false)

    const resolved = resolveBossHpKey(unknown)
    expect(resolved).toBeNull()
    expect(resolved).not.toBe(unknown)
    expect(resolved).not.toBe('Avatar')
    expect(resolved).not.toBe('Magnus')
  })

  it('returns null for empty / falsy input', () => {
    expect(resolveBossHpKey('')).toBeNull()
  })
})
