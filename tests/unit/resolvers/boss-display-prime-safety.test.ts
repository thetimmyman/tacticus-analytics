import { describe, it, expect } from 'vitest'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

/** getBossDisplayName collapses prefixed tokens, so prime rows must not pass through it. */
describe('getBossDisplayName — prime safety', () => {
  it('resolves raw main boss_type tokens to their curated names', () => {
    expect(getBossDisplayName('BelisariusRW')).toBe('Belisarius Cawl')
    expect(getBossDisplayName('Ghazghkull')).toBe('Ghazghkull Thraka')
    expect(getBossDisplayName('RogalDorn')).toBe('Rogal Dorn')
  })

  it('leaves every currently-seeded prime character name unchanged', () => {
    const primeNames = [
      'Sibyll',
      "Tan Gi'da",
      'Actus',
      'Baraqiel',
      'Forcas',
      'Mesophet',
      'Abraxas',
      'Thaumacus',
      'Neurothrope',
      'Corrodius',
      'Tyranid Warrior (Leviathan)',
      'Tyranid Warrior (Kronos)',
      'Tyranid Warrior (Gorgon)'
    ]
    for (const name of primeNames) {
      expect(getBossDisplayName(name)).toBe(name)
    }
  })

  it('DOCUMENTS the latent collapse: a prime whose name begins with a tracked prefix WOULD collapse onto its main', () => {
    expect(getBossDisplayName('Belisarius Prime')).toBe('Belisarius Cawl')
    expect(getBossDisplayName('Tervigon Broodling')).toBe('Tervigon')
  })
})
