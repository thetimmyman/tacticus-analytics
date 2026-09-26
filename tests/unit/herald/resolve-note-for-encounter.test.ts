/** An explicit `null` note (key present) must not resurrect the legacy herald_boss_config note. */
import { describe, expect, it } from 'vitest'
import {
  resolveNoteForEncounter,
  type SeasonNotes
} from '@/app/lib/herald/season-state'
import type { HeraldBossConfigRow } from '@/app/lib/herald/config'

const bossConfigWithLegacyNote: HeraldBossConfigRow = {
  boss_id: 'Magnus_E0',
  rarity_set: null,
  enabled: true,
  webhook_config_ids: [],
  discord_role_ids: [],
  discord_role_labels: {},
  extra_links: [],
  extra_videos: [],
  custom_message_url: null,
  notes: 'legacy main note',
  side1_notes: 'legacy side1 note',
  side2_notes: 'legacy side2 note',
  side1_behaviour: 'kill',
  side2_behaviour: 'kill',
  side1_threshold_hp_pct: null,
  side2_threshold_hp_pct: null,
  ping_mode: 'combined',
  ping_mode_explicit: false
}

describe('resolveNoteForEncounter — boss WITH a legacy note', () => {
  it('an explicit null season override resolves to null — NO fallback to the legacy note', () => {
    const seasonNotes: SeasonNotes = {
      main_notes: null,
      side1_notes: undefined,
      side2_notes: undefined
    }
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 0)
    ).toBeNull()
  })

  it('an undefined season override (never set) falls back to the legacy note', () => {
    const seasonNotes: SeasonNotes = {
      main_notes: undefined,
      side1_notes: undefined,
      side2_notes: undefined
    }
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 0)
    ).toBe('legacy main note')
  })

  it('a string season override wins outright', () => {
    const seasonNotes: SeasonNotes = {
      main_notes: 'season override text',
      side1_notes: undefined,
      side2_notes: undefined
    }
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 0)
    ).toBe('season override text')
  })

  it('a null seasonNotes row (no per-season row at all) falls back to the legacy note', () => {
    expect(resolveNoteForEncounter(bossConfigWithLegacyNote, null, 1)).toBe(
      'legacy side1 note'
    )
  })

  it('clearing side1 does not clear side2 or main', () => {
    const seasonNotes: SeasonNotes = {
      main_notes: undefined,
      side1_notes: null,
      side2_notes: undefined
    }
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 1)
    ).toBeNull()
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 0)
    ).toBe('legacy main note')
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 2)
    ).toBe('legacy side2 note')
  })

  it('a blank/whitespace-only override string is treated as unset, not as an explicit clear', () => {
    // A stray blank string still defers to the legacy note, matching the dispatcher.
    const seasonNotes: SeasonNotes = {
      main_notes: '   ',
      side1_notes: undefined,
      side2_notes: undefined
    }
    expect(
      resolveNoteForEncounter(bossConfigWithLegacyNote, seasonNotes, 0)
    ).toBe('legacy main note')
  })
})

describe('resolveNoteForEncounter — boss with NO legacy note (control; does not prove the fix)', () => {
  const bossConfigNoLegacyNote: HeraldBossConfigRow = {
    ...bossConfigWithLegacyNote,
    notes: null,
    side1_notes: null,
    side2_notes: null
  }

  it('an explicit null override and an undefined override both resolve to null here', () => {
    expect(
      resolveNoteForEncounter(
        bossConfigNoLegacyNote,
        { main_notes: null, side1_notes: undefined, side2_notes: undefined },
        0
      )
    ).toBeNull()
    expect(
      resolveNoteForEncounter(
        bossConfigNoLegacyNote,
        {
          main_notes: undefined,
          side1_notes: undefined,
          side2_notes: undefined
        },
        0
      )
    ).toBeNull()
  })
})
