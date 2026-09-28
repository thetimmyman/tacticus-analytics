import { describe, expect, it } from 'vitest'
import { normalizeTopBossHits } from '@/app/(public)/explore/utils'

const normalizeMetaTeam = (metaTeam?: unknown, heroDetails?: string) =>
  normalizeTopBossHits([
    {
      ...(metaTeam === undefined ? {} : { metaTeam }),
      ...(heroDetails === undefined ? {} : { heroDetails })
    }
  ])[0]?.metaTeam

describe('normalizeTopBossHits metaTeam snapshot contract', () => {
  it.each([
    ['current canonical label', 'Admech', 'Admech'],
    ['future nonblank label', 'Future Formation', 'Future Formation'],
    [
      'padded future nonblank label',
      '  Future Formation  ',
      'Future Formation'
    ],
    ['null', null, 'Other'],
    ['missing', undefined, 'Other'],
    ['blank', '   ', 'Other'],
    ['non-string', { team: 'Admech' }, 'Other'],
    ['case-insensitive legacy Unknown sentinel', 'uNkNoWn', 'Other']
  ])('normalizes %s', (_caseName, input, expected) => {
    expect(normalizeMetaTeam(input)).toBe(expected)
  })

  it('does not derive metaTeam from heroDetails', () => {
    const legacyHeuristicMatch = JSON.stringify([
      { unitId: 'ork_ghazghkull' },
      { unitId: 'ork_makari' }
    ])

    expect(normalizeMetaTeam(undefined, legacyHeuristicMatch)).toBe('Other')
    expect(normalizeMetaTeam('Future Formation', legacyHeuristicMatch)).toBe(
      'Future Formation'
    )
  })
})
