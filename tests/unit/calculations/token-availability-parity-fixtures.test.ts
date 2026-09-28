/** TS <-> SQL goldens mirrored in supabase/tests/pgtap/availability_parity.sql; keep in lockstep. */
import { describe, it, expect } from 'vitest'
import { calculateTokenAvailability } from '@/app/lib/calculations/token-calculation'

const HOUR_MS = 60 * 60 * 1000
const NOW = new Date('2026-07-02T12:00:00Z')

function replay(offsetsHours: number[], anchorOffsetHours?: number) {
  const battles = offsetsHours.map((h) => ({
    displayName: 'ParityFixture',
    damageType: 'Battle' as const,
    startedOn: new Date(NOW.getTime() - h * HOUR_MS).toISOString()
  }))
  const anchor =
    anchorOffsetHours === undefined
      ? undefined
      : new Date(NOW.getTime() - anchorOffsetHours * HOUR_MS)
  const result = calculateTokenAvailability(battles, anchor, NOW)
  return {
    tokensAvailable: result.tokensAvailable,
    tokenNextSeconds: result.tokenNextSeconds ?? null
  }
}

describe('availability parity goldens (mirror: availability_parity.sql)', () => {
  it('A: spend-to-zero keeps the regen anchor (battles -20h, -14h)', () => {
    // init 2 @-20h -> 1; -14h -> 0 (timer stays -20h); pop -8h -> 1; next +4h.
    expect(replay([20, 14])).toEqual({
      tokensAvailable: 1,
      tokenNextSeconds: 14400
    })
  })

  it('B: recent spend-to-zero (battles -8h, -2h)', () => {
    expect(replay([8, 2])).toEqual({
      tokensAvailable: 0,
      tokenNextSeconds: 14400
    })
  })

  it('C: interleaved spends and pops (battles -30h, -20h, -10h)', () => {
    // init 2 @-30h -> 1; -20h -> 0; pop -18h -> 1; -10h -> 0; pop -6h -> 1; next +6h.
    expect(replay([30, 20, 10])).toEqual({
      tokensAvailable: 1,
      tokenNextSeconds: 21600
    })
  })

  it('D: idle regen reaches the cap and pauses (battle -40h)', () => {
    expect(replay([40])).toEqual({ tokensAvailable: 3, tokenNextSeconds: null })
  })

  // Regen runs from the season-window start, not the player's first battle.

  it('E: pre-first-battle regen caps before the spend (anchor -30h, battle -4h)', () => {
    // init 2 @-30h; pops cap at 3 (timer rebases at -4h); spend -> 2; next +8h.
    expect(replay([4], 30)).toEqual({
      tokensAvailable: 2,
      tokenNextSeconds: 28800
    })
  })

  it('F: anchored regen phase survives a below-cap spend (anchor -10h, battle -4h)', () => {
    expect(replay([4], 10)).toEqual({
      tokensAvailable: 1,
      tokenNextSeconds: 7200
    })
  })

  it('G: battle predating the anchor degrades to first-battle anchor (anchor -10h, battle -20h)', () => {
    // min(anchor, first battle) -> -20h, same as unanchored case A.
    expect(replay([20], 10)).toEqual({
      tokensAvailable: 2,
      tokenNextSeconds: 14400
    })
  })

  it('H: no battles regen from the anchor and pause at cap (anchor -26h)', () => {
    expect(replay([], 26)).toEqual({
      tokensAvailable: 3,
      tokenNextSeconds: null
    })
  })

  it('I: spend-to-zero then long idle regen across a gap (anchor -60h, battles -55h, -50h, -3h)', () => {
    // init 2 @-60h; spends -> 0; pops cap at 3 (rebased at -3h); spend -> 2; next +9h.
    expect(replay([55, 50, 3], 60)).toEqual({
      tokensAvailable: 2,
      tokenNextSeconds: 32400
    })
  })

  // A future season start must never run regen over a negative interval.

  it('J: future anchor with battles degrades to the first-battle anchor (anchor +10h, battle -20h)', () => {
    expect(replay([20], -10)).toEqual({
      tokensAvailable: 2,
      tokenNextSeconds: 14400
    })
  })

  it('K: future anchor with no battles yields the frozen initial state (anchor +10h)', () => {
    expect(replay([], -10)).toEqual({
      tokensAvailable: 2,
      tokenNextSeconds: null
    })
  })
})
