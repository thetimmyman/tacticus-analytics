import type { ComponentProps } from 'react'
import type { UpgradePathMetro } from '@/app/(dashboard)/meta-atlas/components/UpgradePathMetro'
import type {
  HeroRequirement,
  StrengthThresholds
} from '@/app/lib/meta/roster-strength'
import type { UpgradeStep } from '@/app/lib/meta/types'
import type { HeroMapping } from '@/app/(dashboard)/meta-atlas/utils/hero-mapping'

/**
 * Synthetic upgrade path shared by the Storybook fixture and the panel tests:
 * three steps (the middle one locked, the last one owned) over a roster that walks every strength state.
 */

const NAMES = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'Walker'
]

const HERO_MAPPINGS = new Map<string, HeroMapping>(
  NAMES.map((name) => [
    name.toLowerCase(),
    { unit_id: name, display_name: name, web_icon_url: null }
  ])
)

const requirement = (name: string): HeroRequirement => ({
  hero_name: name,
  min_rank: null,
  min_rank_index: 4,
  min_ability_active: null,
  min_ability_passive: null,
  min_ability_mythic: null,
  min_rarity: null,
  min_stars: null
})

const HERO_OVERRIDES = new Map<string, HeroRequirement>(
  NAMES.map((name) => [name.toLowerCase(), requirement(name)])
)

// Ranks walk every strength state: Alpha and Foxtrot optimal, Bravo and Golf
// strong, Charlie and Walker suitable, Delta weak (needs investment), Echo has
// no rank (unknown) and Hotel is not on the roster (locked).
const ROSTER = [
  { name: 'Alpha', rank: 9 },
  { name: 'Bravo', rank: 7 },
  { name: 'Charlie', rank: 5 },
  { name: 'Delta', rank: 2 },
  { name: 'Echo' },
  { name: 'Foxtrot', rank: 9 },
  { name: 'Golf', rank: 7 },
  { name: 'Walker', rank: 5 }
]

const THRESHOLDS: StrengthThresholds = {
  suitable: 0,
  strong: 0,
  optimal: 0,
  source: 'data',
  sampleSize: 10,
  abilityMinimums: null,
  rankThresholds: { weak: 2, suitable: 4, strong: 6, optimal: 8 },
  rarity: null
}

const step = (
  index: number,
  fromTeam: string,
  toTeam: string,
  out: string,
  into: string,
  gain: number,
  damage: number,
  owned: boolean
): UpgradeStep => ({
  step_index: index,
  from_team: fromTeam,
  to_team: toTeam,
  swapped_out: out,
  swapped_in: into,
  swap_out: out,
  swap_in: into,
  damage_increase: gain,
  damage_gain: gain,
  percent_increase: 0,
  new_damage_p90: damage,
  meta_team: null,
  is_owned: owned,
  next_node_id: `n${index}`
})

const T0 = 'Alpha, Bravo, Charlie, Delta, Echo + Walker'
const T1 = 'Alpha, Bravo, Charlie, Delta, Foxtrot + Walker'
const T2 = 'Alpha, Bravo, Hotel, Delta, Foxtrot + Walker'
const T3 = 'Alpha, Bravo, Charlie, Golf, Foxtrot + Walker'

const STEPS: UpgradeStep[] = [
  step(1, T0, T1, 'Echo', 'Foxtrot', 100_000, 1_100_000, true),
  step(2, T1, T2, 'Charlie', 'Hotel', 120_000, 1_220_000, false),
  step(3, T2, T3, 'Hotel, Delta', 'Charlie, Golf', 230_000, 1_450_000, true)
]

export const METRO_FIXTURE_PROPS: ComponentProps<typeof UpgradePathMetro> = {
  currentTeam: T0,
  targetTeam: T3,
  currentDamage: 1_000_000,
  targetDamage: 1_450_000,
  steps: STEPS,
  currentLabel: 'Current',
  defaultActiveIndex: 1,
  activeBadgeLabel: 'Best',
  heroMappings: HERO_MAPPINGS,
  rosterEntries: ROSTER,
  strengthThresholds: THRESHOLDS,
  heroOverrides: HERO_OVERRIDES
}
