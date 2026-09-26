import { describe, expect, it } from 'vitest'
import { buildHeraldCanonicalKey } from '@/app/lib/boss-assignments/herald-canonical-key'

describe('buildHeraldCanonicalKey', () => {
  it('collapses wrapped Tacticus table ids to the same keys the client normalizer uses', () => {
    expect(buildHeraldCanonicalKey('ThousMagnus_E0')).toBe('magnus')
    expect(buildHeraldCanonicalKey('BelisariusRW_E0')).toBe('belisarius')
    expect(buildHeraldCanonicalKey('RogalDorn_E0')).toBe('rogaldorn')
    expect(buildHeraldCanonicalKey('Mortarian_E0')).toBe('mortarion')
    expect(buildHeraldCanonicalKey('SilentKing_E0')).toBe('silentking')
    expect(buildHeraldCanonicalKey('Szarekh_E0')).toBe('silentking')
    expect(buildHeraldCanonicalKey('ScreamerKiller_E0')).toBe('screamer_killer')
  })

  it('rejects malformed Herald boss ids', () => {
    expect(buildHeraldCanonicalKey('BelisariusRW')).toBe('')
    expect(buildHeraldCanonicalKey('')).toBe('')
  })
})
