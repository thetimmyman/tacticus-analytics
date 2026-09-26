import { describe, expect, it } from 'vitest'
import {
  buildRosterEntryIndex,
  rankMetaTeamProgressions,
  resolveDefaultMetaTeamKey,
  resolvePotentialDelta,
  selectMetaTeamProgression
} from '@/app/(dashboard)/meta-atlas/components/personal-potential-model'
import type {
  BossData,
  MetaTeamProgression
} from '@/app/(dashboard)/meta-atlas/types'

const progressions = [
  { meta_team: 'AdMech', target_team: { damage_p90: 120 } },
  { meta_team: 'Neuro', target_team: { damage_p90: 180 } }
] as MetaTeamProgression[]

describe('personal potential model', () => {
  it('prefers the buildable team and falls back to the first available team', () => {
    const preferred = {
      best_buildable_info: { meta_team: 'Neuro' },
      recommendations: []
    } as unknown as BossData
    const missing = {
      best_buildable_info: { meta_team: 'Unknown' },
      recommendations: []
    } as unknown as BossData

    expect(resolveDefaultMetaTeamKey(preferred, progressions)).toBe('Neuro')
    expect(resolveDefaultMetaTeamKey(missing, progressions)).toBe('AdMech')
  })

  it('ranks by target damage and resolves a selected progression', () => {
    const rankings = rankMetaTeamProgressions(progressions)

    expect(rankings.get('Neuro')).toBe(1)
    expect(selectMetaTeamProgression(progressions, 'AdMech')?.meta_team).toBe(
      'AdMech'
    )
  })

  it('indexes roster aliases to the original entry', () => {
    const entry = {
      id: 'hero-id',
      engineId: 'HeroEngine',
      name: 'Hero Name'
    }
    const index = buildRosterEntryIndex([entry])

    expect(index.get('heroid')).toBe(entry)
    expect(index.get('heroengine')).toBe(entry)
    expect(index.get('heroname')).toBe(entry)
  })

  it('prefers measured damage delta over the fallback increase', () => {
    expect(resolvePotentialDelta(100.4, 151.1, 999)).toBe(51)
    expect(resolvePotentialDelta(null, null, 12.6)).toBe(13)
    expect(resolvePotentialDelta(null, null, 0)).toBeNull()
  })
})
