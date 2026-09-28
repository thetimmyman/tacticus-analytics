/** Untouched primes are not rewritten: mount-time state would revert a skip set elsewhere. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persistSideSettings } from '@/app/lib/boss-ops/persistence'
import type {
  BossState,
  HeraldBossSummary,
  SideState
} from '@/app/lib/boss-ops/encounter-ops-types'

const BOSS: HeraldBossSummary = {
  group_key: 'magnus-m1',
  boss_type: 'Magnus',
  boss_name: 'Magnus the Red',
  rarity: 'Mythic',
  set: 0, // 0-BASED here; raritySetForBoss adds one -> 'M1'
  main: { boss_id: 'Magnus_E0', boss_name: 'Magnus the Red', encounter_id: 0 },
  sides: [
    { boss_id: 'Magnus_E1', boss_name: 'Abraxas', encounter_id: 1 },
    { boss_id: 'Magnus_E2', boss_name: 'Thaumachus', encounter_id: 2 }
  ]
}

const side = (patch: Partial<SideState> = {}): SideState => ({
  role: '',
  behaviour: 'kill',
  threshold: 60,
  notes: '',
  ...patch
})

const stateWith = (s1: SideState, s2: SideState): BossState => ({
  group_key: BOSS.group_key,
  expanded: true,
  mainRole: '',
  mainNotes: '',
  pingMode: 'per_side',
  side1: s1,
  side2: s2,
  saveStatus: 'idle',
  dirty: true,
  editVersion: 1
})

let calls: Array<{ url: string; body: Record<string, unknown> }> = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}'))
      })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  )
})
afterEach(() => vi.unstubAllGlobals())

const skipWrites = () =>
  calls.filter((c) => c.url.includes('skip-prime')).map((c) => c.body.sub_index)

describe('persistSideSettings baseline (D6)', () => {
  it('writes NEITHER prime when both match what was hydrated', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side({ behaviour: 'kill' }), side({ behaviour: 'skip' })),
      'TESTGUILD',
      '103',
      { side1Behaviour: 'kill', side2Behaviour: 'skip' }
    )
    expect(skipWrites()).toEqual([])
  })

  it('writes ONLY the prime the officer actually changed', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side({ behaviour: 'skip' }), side({ behaviour: 'kill' })),
      'TESTGUILD',
      '103',
      { side1Behaviour: 'kill', side2Behaviour: 'kill' }
    )
    expect(skipWrites()).toEqual([1])
  })

  it('treats a threshold percentage change as a change', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(
        side({ behaviour: 'threshold', threshold: 40 }),
        side({ behaviour: 'kill' })
      ),
      'TESTGUILD',
      '103',
      {
        side1Behaviour: 'threshold',
        side1ThresholdHpPct: 60,
        side2Behaviour: 'kill'
      }
    )
    expect(skipWrites()).toEqual([1])
  })

  it('ignores the threshold value when neither side is on threshold', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side({ behaviour: 'kill', threshold: 20 }), side()),
      'TESTGUILD',
      '103',
      {
        side1Behaviour: 'kill',
        side1ThresholdHpPct: 80,
        side2Behaviour: 'kill'
      }
    )
    expect(skipWrites()).toEqual([])
  })

  it('always writes both primes for an explicit skip_all', async () => {
    const state = stateWith(side(), side())
    state.pingMode = 'skip_all'
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', {
      side1Behaviour: 'kill',
      side2Behaviour: 'kill'
    })
    expect(skipWrites()).toEqual([1, 2])
    expect(
      calls
        .filter((c) => c.url.includes('skip-prime'))
        .every((c) => c.body.skip === true)
    ).toBe(true)
  })

  it('preserves the previous always-write behaviour when no baseline is given', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side(), side()),
      'TESTGUILD',
      '103'
    )
    expect(skipWrites()).toEqual([1, 2])
  })

  it('does not drop a REVERT when the baseline is advanced after each save', async () => {
    // Without advancing the baseline, Skip → Save → Kill → Save writes nothing.
    let baseline = {
      side1Behaviour: 'kill' as const,
      side2Behaviour: 'kill' as const
    }

    await persistSideSettings(
      BOSS,
      stateWith(side({ behaviour: 'skip' }), side()),
      'TESTGUILD',
      '103',
      baseline
    )
    expect(skipWrites()).toEqual([1])

    baseline = {
      side1Behaviour: 'skip' as const,
      side2Behaviour: 'kill' as const
    }
    calls = []

    await persistSideSettings(
      BOSS,
      stateWith(side({ behaviour: 'kill' }), side()),
      'TESTGUILD',
      '103',
      baseline
    )
    expect(skipWrites()).toEqual([1])
    expect(calls.find((c) => c.url.includes('skip-prime'))!.body.skip).toBe(
      false
    )
  })

  it('sends the 1-based stage code derived from the 0-based summary set', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side({ behaviour: 'skip' }), side()),
      'TESTGUILD',
      '103',
      { side1Behaviour: 'kill', side2Behaviour: 'kill' }
    )
    const call = calls.find((c) => c.url.includes('skip-prime'))!
    expect(call.body.level).toBe('M1')
  })
})

/** `skip_all` compares effective behaviour, not the raw mode. */
describe('persistSideSettings skip_all transitions (review F2)', () => {
  const tokenPuts = () =>
    calls.filter((c) => c.url.includes('target-tokens')).map((c) => c.body)

  it('entering skip_all writes skip once and mirrors it into the token store', async () => {
    const state = stateWith(side(), side())
    state.pingMode = 'skip_all'
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', {
      side1Behaviour: 'kill',
      side2Behaviour: 'kill',
      side1TargetTokens: 7,
      side2TargetTokens: null
    })
    expect(skipWrites()).toEqual([1, 2])
    expect(
      calls
        .filter((c) => c.url.includes('skip-prime'))
        .every((c) => c.body.skip === true)
    ).toBe(true)
    const puts = tokenPuts()
    expect(puts).toHaveLength(2)
    expect(puts.every((b) => b.skip === true)).toBe(true)
    expect(puts.map((b) => b.target_tokens).sort()).toEqual([1, 7])
  })

  it('a later save while STILL in skip_all writes nothing (baseline advanced to skip)', async () => {
    const state = stateWith(side(), side())
    state.pingMode = 'skip_all'
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', {
      side1Behaviour: 'skip',
      side2Behaviour: 'skip',
      pingMode: 'skip_all'
    })
    expect(skipWrites()).toEqual([])
    expect(tokenPuts()).toEqual([])
  })

  it('exiting skip_all writes the un-skip and clears the token mirror', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side(), side()),
      'TESTGUILD',
      '103',
      {
        side1Behaviour: 'skip',
        side2Behaviour: 'skip',
        pingMode: 'skip_all',
        side1TargetTokens: 7,
        side2TargetTokens: 1
      }
    )
    expect(skipWrites()).toEqual([1, 2])
    expect(
      calls
        .filter((c) => c.url.includes('skip-prime'))
        .every((c) => c.body.skip === false)
    ).toBe(true)
    const puts = tokenPuts()
    expect(puts).toHaveLength(2)
    expect(puts.every((b) => b.skip === false)).toBe(true)
  })

  it('exiting skip_all with NO stored token suppresses the mirror (F5/C11)', async () => {
    // A PUT here would materialise a placeholder row over an auto-deriving prime.
    await persistSideSettings(
      BOSS,
      stateWith(side(), side()),
      'TESTGUILD',
      '103',
      {
        side1Behaviour: 'skip',
        side2Behaviour: 'skip',
        pingMode: 'skip_all',
        side1TargetTokens: null,
        side2TargetTokens: null
      }
    )
    expect(skipWrites()).toEqual([1, 2])
    expect(tokenPuts()).toEqual([])
  })
})

describe('persistSideSettings notes/ping gating (D2)', () => {
  const notesModeCalls = () => calls.filter((c) => c.url.includes('notes-mode'))

  const NOTES_BASELINE = {
    side1Behaviour: 'kill' as const,
    side2Behaviour: 'kill' as const,
    mainNotes: null,
    side1Notes: null,
    side2Notes: null,
    pingMode: 'per_side' as const
  }

  it('skips the notes-mode POST entirely when no gated field changed', async () => {
    await persistSideSettings(
      BOSS,
      stateWith(side(), side()),
      'TESTGUILD',
      '103',
      NOTES_BASELINE
    )
    expect(notesModeCalls()).toEqual([])
  })

  it('treats a blank state note as equal to a null baseline', async () => {
    // Seeded '' must not read as "cleared" against a null hydration.
    const state = stateWith(side({ notes: '' }), side({ notes: '' }))
    state.mainNotes = ''
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', NOTES_BASELINE)
    expect(notesModeCalls()).toEqual([])
  })

  it('sends ONLY the note the officer actually changed', async () => {
    const state = stateWith(side(), side())
    state.mainNotes = 'focus the adds first'
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', NOTES_BASELINE)

    const [call, ...rest] = notesModeCalls()
    expect(rest).toEqual([])
    expect(call!.body.main_notes).toBe('focus the adds first')
    expect(call!.body).not.toHaveProperty('side1_notes')
    expect(call!.body).not.toHaveProperty('side2_notes')
    expect(call!.body).not.toHaveProperty('ping_mode')
  })

  it('coerces a cleared note to null, never empty string', async () => {
    // '' shadows the herald fallback note instead of falling through.
    const state = stateWith(side({ notes: '   ' }), side())
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', {
      ...NOTES_BASELINE,
      side1Notes: 'stale per-season note'
    })
    const call = notesModeCalls()[0]!
    expect(call.body.side1_notes).toBeNull()
  })

  it('sends a changed ping_mode and omits unchanged notes alongside it', async () => {
    const state = stateWith(side(), side())
    state.pingMode = 'combined'
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103', NOTES_BASELINE)
    const call = notesModeCalls()[0]!
    expect(call.body.ping_mode).toBe('combined')
    expect(call.body).not.toHaveProperty('main_notes')
    expect(call.body).not.toHaveProperty('side1_notes')
    expect(call.body).not.toHaveProperty('side2_notes')
  })

  it('preserves the previous full-send behaviour when no baseline is given', async () => {
    const state = stateWith(side({ notes: 'one' }), side())
    state.mainNotes = 'main'
    await persistSideSettings(BOSS, state, 'TESTGUILD', '103')
    const call = notesModeCalls()[0]!
    expect(call.body.main_notes).toBe('main')
    expect(call.body.side1_notes).toBe('one')
    expect(call.body.side2_notes).toBeNull()
    expect(call.body.ping_mode).toBe('per_side')
  })
})
