import { describe, expect, it } from 'vitest'

import {
  calculateTokenAvailability,
  INITIAL_TOKENS,
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

describe('WI-2213 token SQL parity fixtures', () => {
  it('pins the no-battle season-start fixture mirrored by compute_player_token_burn pgTAP', () => {
    const seasonStart = new Date('2026-01-01T00:00:00Z')
    const evaluatedAt = new Date('2026-01-04T00:00:00Z')
    const elapsedSeconds =
      (evaluatedAt.getTime() - seasonStart.getTime()) / 1000

    const result = calculateTokenAvailability([], seasonStart, evaluatedAt)

    const regenCycles = Math.floor(elapsedSeconds / TWELVE_HOURS_IN_SECONDS)
    const refillCycles = MAX_TOKENS - INITIAL_TOKENS

    expect(result.tokensAvailable).toBe(MAX_TOKENS)
    expect(result.tokenStatus).toEqual({
      count: MAX_TOKENS,
      refreshTime: Math.floor(evaluatedAt.getTime() / 1000)
    })
    expect(regenCycles - refillCycles).toBe(5)
    expect(elapsedSeconds - refillCycles * TWELVE_HOURS_IN_SECONDS).toBe(
      60 * 60 * 60
    )
  })
})
