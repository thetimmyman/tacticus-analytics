/** Merge precedence shared by /boss-playbooks and /boss-assignments/targets. */
import { describe, expect, it } from 'vitest'
import {
  resolveEncounterOps,
  type EncounterHeraldConfigView,
  type EncounterSeasonOpsView
} from '@/app/lib/boss-ops/encounter-ops-merge'

const heraldConfig = (
  overrides: Partial<EncounterHeraldConfigView> = {}
): EncounterHeraldConfigView => ({
  discordRoleIds: ['111111111111111111'],
  discordRoleLabels: { '111111111111111111': 'Alpha' },
  notes: 'herald main note',
  side1Notes: 'herald side1 note',
  side2Notes: 'herald side2 note',
  ...overrides
})

// `undefined` = never set (Herald fallback); `null` = explicitly cleared.
const seasonOps = (
  overrides: Partial<EncounterSeasonOpsView> = {}
): EncounterSeasonOpsView => ({
  mainNotes: undefined,
  side1Notes: undefined,
  side2Notes: undefined,
  side1Behaviour: 'kill',
  side2Behaviour: 'kill',
  side1ThresholdHpPct: null,
  side2ThresholdHpPct: null,
  ...overrides
})

describe('resolveEncounterOps', () => {
  describe('notes precedence — season ops WIN over the Herald snapshot', () => {
    it('prefers the season note for the main boss', () => {
      const resolved = resolveEncounterOps({
        encounterId: 0,
        seasonOps: seasonOps({ mainNotes: 'season main note' }),
        heraldConfig: heraldConfig()
      })
      expect(resolved.notes).toBe('season main note')
    })

    it('prefers the season note for each prime independently', () => {
      expect(
        resolveEncounterOps({
          encounterId: 1,
          seasonOps: seasonOps({ side1Notes: 'season side1 note' }),
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('season side1 note')

      expect(
        resolveEncounterOps({
          encounterId: 2,
          seasonOps: seasonOps({ side1Notes: 'season side1 note' }),
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('herald side2 note')
    })

    it('falls back to the Herald snapshot when the season note is unset', () => {
      expect(
        resolveEncounterOps({
          encounterId: 0,
          seasonOps: seasonOps(),
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('herald main note')
      expect(
        resolveEncounterOps({
          encounterId: 1,
          seasonOps: seasonOps(),
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('herald side1 note')
    })

    it('resolves to null when neither store has a note', () => {
      expect(
        resolveEncounterOps({
          encounterId: 2,
          seasonOps: null,
          heraldConfig: heraldConfig({ side2Notes: null })
        }).notes
      ).toBeNull()
    })

    it('PS-455: an explicitly cleared (null) season note stays cleared — no fallback to the Herald snapshot', () => {
      expect(
        resolveEncounterOps({
          encounterId: 0,
          seasonOps: seasonOps({ mainNotes: null }),
          heraldConfig: heraldConfig()
        }).notes
      ).toBeNull()
      expect(
        resolveEncounterOps({
          encounterId: 1,
          seasonOps: seasonOps({ side1Notes: null }),
          heraldConfig: heraldConfig()
        }).notes
      ).toBeNull()
    })

    it('PS-455: clearing one encounter does not clear a sibling encounter', () => {
      const ops = seasonOps({ side1Notes: null })
      expect(
        resolveEncounterOps({
          encounterId: 1,
          seasonOps: ops,
          heraldConfig: heraldConfig()
        }).notes
      ).toBeNull()
      expect(
        resolveEncounterOps({
          encounterId: 2,
          seasonOps: ops,
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('herald side2 note')
      expect(
        resolveEncounterOps({
          encounterId: 0,
          seasonOps: ops,
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('herald main note')
    })

    it('treats an empty-string season note as SET, not unset (?? not ||)', () => {
      // The resolver must not re-promote the stale Herald note for ''.
      expect(
        resolveEncounterOps({
          encounterId: 1,
          seasonOps: seasonOps({ side1Notes: '' }),
          heraldConfig: heraldConfig()
        }).notes
      ).toBe('')
    })
  })

  describe('behaviour + threshold come from season ops only', () => {
    it("defaults to 'kill' with a null threshold when there is no season-ops row", () => {
      const resolved = resolveEncounterOps({
        encounterId: 1,
        seasonOps: null,
        heraldConfig: heraldConfig()
      })
      expect(resolved.behaviour).toBe('kill')
      expect(resolved.thresholdHpPct).toBeNull()
    })

    it('reads each prime from its own side keys', () => {
      const ops = seasonOps({
        side1Behaviour: 'skip',
        side2Behaviour: 'threshold',
        side2ThresholdHpPct: 60
      })
      const side1 = resolveEncounterOps({
        encounterId: 1,
        seasonOps: ops,
        heraldConfig: null
      })
      const side2 = resolveEncounterOps({
        encounterId: 2,
        seasonOps: ops,
        heraldConfig: null
      })
      expect(side1.behaviour).toBe('skip')
      expect(side1.thresholdHpPct).toBeNull()
      expect(side2.behaviour).toBe('threshold')
      expect(side2.thresholdHpPct).toBe(60)
    })

    it("forces encounter 0 to 'kill' with a null threshold even if the row says otherwise", () => {
      // The main boss cannot skip; a prime's rule here would render an unsaveable toggle.
      const resolved = resolveEncounterOps({
        encounterId: 0,
        seasonOps: seasonOps({
          side1Behaviour: 'skip',
          side1ThresholdHpPct: 40,
          side2Behaviour: 'threshold',
          side2ThresholdHpPct: 60
        }),
        heraldConfig: null
      })
      expect(resolved.behaviour).toBe('kill')
      expect(resolved.thresholdHpPct).toBeNull()
    })

    it("resolves an unknown encounter index to 'kill' / null / no notes", () => {
      const resolved = resolveEncounterOps({
        encounterId: 3,
        seasonOps: seasonOps({ mainNotes: 'season main note' }),
        heraldConfig: heraldConfig()
      })
      expect(resolved.behaviour).toBe('kill')
      expect(resolved.thresholdHpPct).toBeNull()
      expect(resolved.notes).toBeNull()
    })
  })

  describe('roles come from the Herald snapshot only', () => {
    it('passes role ids and labels straight through', () => {
      const resolved = resolveEncounterOps({
        encounterId: 1,
        seasonOps: seasonOps({ side1Behaviour: 'skip' }),
        heraldConfig: heraldConfig({
          discordRoleIds: ['222222222222222222'],
          discordRoleLabels: { '222222222222222222': 'Bravo' }
        })
      })
      expect(resolved.roleIds).toEqual(['222222222222222222'])
      expect(resolved.roleLabels).toEqual({ '222222222222222222': 'Bravo' })
    })

    it('defaults to an empty list/map with no Herald row', () => {
      const resolved = resolveEncounterOps({
        encounterId: 1,
        seasonOps: seasonOps(),
        heraldConfig: null
      })
      expect(resolved.roleIds).toEqual([])
      expect(resolved.roleLabels).toEqual({})
    })
  })
})
