import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TeamCard } from '@/app/(dashboard)/meta-atlas/components/TeamCard'
import type { BossRecommendation } from '@/app/(dashboard)/meta-atlas/types'

const RECOMMENDATION: BossRecommendation = {
  team_hash: 'hash-1',
  team_composition: 'Ragnar, Kharn + Forgefiend',
  meta_team: 'Double Howl',
  rarity_set: 'L1',
  sub_boss_name: null,
  encounter_index: 0,
  damage_p90: 1_200_000,
  damage_p75: 1_000_000,
  damage_max: 2_000_000,
  damage_avg: 900_000,
  attack_count: 142,
  season: '105'
}

describe('TeamCard battle-count chip', () => {
  it('shows the attack count as a visible labelled chip', () => {
    render(<TeamCard rec={RECOMMENDATION} rank={1} heroMappings={new Map()} />)

    expect(screen.getByText('142 atk')).toBeTruthy()
    expect(screen.getByTitle('142 attacks — High confidence')).toBeTruthy()
  })

  it('labels small samples as low confidence', () => {
    render(
      <TeamCard
        rec={{ ...RECOMMENDATION, attack_count: 12 }}
        rank={2}
        heroMappings={new Map()}
      />
    )

    expect(screen.getByText('12 atk')).toBeTruthy()
    expect(screen.getByTitle('12 attacks — Low sample size')).toBeTruthy()
  })
})
