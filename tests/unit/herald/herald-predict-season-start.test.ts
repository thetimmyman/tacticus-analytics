/** currentBosses holds only attacked encounters, so season-lineups.json is the stage-unlock fallback. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { predictAvailabilityFromDefeats } from '@/app/lib/herald/predict'
import type { DefeatTransition } from '@/app/lib/herald/contracts'
import {
  ensureRotationSnapshot,
  type SeasonRotationSnapshot
} from '@/app/lib/loki/rotation-cache'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'

vi.mock('@/app/lib/loki/rotation-cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureRotationSnapshot: vi.fn(async () => null)
}))
vi.mock(
  '@/app/lib/boss-assignments/progression-config',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getActiveProgressionConfig: vi.fn(async () => null)
  })
)

const GUILD = '11111111-1111-4111-8111-111111111111'
// Lineup puts AvatarOfKhaine at L4 (EOT set 3, 0-indexed) across all three encounters.
const SEASON = 107

const PROGRESSION: ProgressionConfig = {
  firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2', 'M3'],
  loopSequence: ['L4', 'L5', 'M1', 'M2', 'M3'],
  loopStartStage: 'L4',
  gameVersion: 'test'
}

const l3MainDefeat = (): DefeatTransition => ({
  boss_id: 'Ghazghkull_E0',
  boss_type: 'Ghazghkull',
  boss_display_name: 'Ghazghkull',
  rarity: 'Legendary',
  tier: 4,
  set: 2,
  completed_on: 1_786_000_000_000,
  killer_display_name: null,
  killer_user_id: null,
  season: SEASON,
  loop_index: 0
})

// L4 main observed, primes not: the shape that made the bug silent.
const snapshotWithMainOnly = (): SeasonRotationSnapshot => ({
  resolvedAt: '2026-08-12T15:10:10.562Z',
  seasonNumber: SEASON,
  source: 'live',
  currentConfigId: `live_season_${SEASON}`,
  nextConfigId: 'guild_boss_season_config_4',
  currentBosses: [
    {
      boss_type: 'Ghazghkull',
      boss_name: 'Ghazghkull',
      set: 2,
      encounter_id: 0,
      rarity: 'Legendary',
      canonical: 'ghazghkull',
      variant: null
    },
    {
      boss_type: 'Gibbascrapz',
      boss_name: 'Gibbascrapz',
      set: 2,
      encounter_id: 1,
      rarity: 'Legendary',
      canonical: 'gibbascrapz',
      variant: null
    },
    {
      boss_type: 'AvatarOfKhaine',
      boss_name: 'Avatar of Khaine',
      set: 3,
      encounter_id: 0,
      rarity: 'Legendary',
      canonical: 'avatarofkhaine',
      variant: null
    }
  ],
  nextBosses: [],
  matches: 3,
  observedBosses: [],
  notes: null,
  errorReason: null
})

describe('stage-unlock predictor at season start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveProgressionConfig).mockResolvedValue(PROGRESSION)
  })

  it('precondition: the season lineup overlay still covers the incident season', () => {
    // Fails instead of passing vacuously if the overlay drops season 107.
    const config = getSeasonConfigForSeasonNumber(SEASON)
    expect(config).not.toBeNull()
    const l4 = (config?.bosses ?? []).filter(
      (b) => b.rarity === 'Legendary' && b.set === 3
    )
    expect(l4.map((b) => b.encounter_id).sort()).toEqual([0, 1, 2])
  })

  it('skips a defeat with no season instead of requesting a seasonless config', async () => {
    const out = await predictAvailabilityFromDefeats(
      GUILD,
      [{ ...l3MainDefeat(), season: null }],
      new Map()
    )

    expect(out).toEqual([])
    expect(getActiveProgressionConfig).not.toHaveBeenCalled()
  })

  it('skips prediction when the observed stage is absent from config', async () => {
    vi.mocked(getActiveProgressionConfig).mockResolvedValue({
      firstPassSequence: ['L1', 'L2'],
      loopSequence: ['L1', 'L2'],
      loopStartStage: 'L1',
      gameVersion: 'test'
    })

    await expect(
      predictAvailabilityFromDefeats(GUILD, [l3MainDefeat()], new Map())
    ).resolves.toEqual([])
  })

  it('emits the next stage primes even when only its MAIN has been observed', async () => {
    vi.mocked(ensureRotationSnapshot).mockResolvedValue(snapshotWithMainOnly())

    const out = await predictAvailabilityFromDefeats(
      GUILD,
      [l3MainDefeat()],
      new Map()
    )

    expect(out.map((t) => t.boss_id).sort()).toEqual([
      'AvatarOfKhaine_E1',
      'AvatarOfKhaine_E2'
    ])
    for (const t of out) {
      expect(t.boss_type).toBe('AvatarOfKhaine')
      expect(t.rarity).toBe('Legendary')
      expect(t.set).toBe(3)
      expect(t.season).toBe(SEASON)
      expect(t.loop_index).toBe(0)
    }
  })

  it('honours skip flags against the lineup fallback: both primes skipped → emit the MAIN', async () => {
    // Without L4 in the snapshot the main must come from the lineup, or this guards nothing.
    const noL4 = snapshotWithMainOnly()
    noL4.currentBosses = noL4.currentBosses.filter((b) => b.set !== 3)
    vi.mocked(ensureRotationSnapshot).mockResolvedValue(noL4)

    const skipped = new Map([
      [
        String(SEASON),
        new Set(['AvatarOfKhaine|L4_Sub1', 'AvatarOfKhaine|L4_Sub2'])
      ]
    ])

    const out = await predictAvailabilityFromDefeats(
      GUILD,
      [l3MainDefeat()],
      skipped
    )

    expect(out.map((t) => t.boss_id)).toEqual(['AvatarOfKhaine_E0'])
  })

  it('resolves the stage with no live snapshot at all', async () => {
    vi.mocked(ensureRotationSnapshot).mockResolvedValue(null)

    const out = await predictAvailabilityFromDefeats(
      GUILD,
      [l3MainDefeat()],
      new Map()
    )

    expect(out.map((t) => t.boss_id).sort()).toEqual([
      'AvatarOfKhaine_E1',
      'AvatarOfKhaine_E2'
    ])
  })

  it('still emits nothing for a season the lineup does not cover', async () => {
    vi.mocked(ensureRotationSnapshot).mockResolvedValue(null)

    const out = await predictAvailabilityFromDefeats(
      GUILD,
      [{ ...l3MainDefeat(), season: 42 }],
      new Map()
    )

    expect(out).toEqual([])
  })
})
