import { describe, it, expect } from 'vitest'
import { reduceSeasonOutlook } from '@/app/lib/season-forecast/season-outlook-reduce'
import {
  MS0,
  runFixturePlan,
  buildOutlookPayload
} from '@/app/lib/boss-assignments/season-planner/planner-fixtures'

/** Planning primes moves the homepage forecast finish earlier; token tiles must not move. */

const REDUCE_OPTS = { guildCode: 'TEST', seasonNumber: 99, nowMs: MS0 }

describe('homepage SeasonOutlook — shared planner engine', () => {
  it('main-only reduction is byte-identical to the documented baseline', () => {
    const plan = runFixturePlan(false)
    const reduced = reduceSeasonOutlook(buildOutlookPayload(plan), REDUCE_OPTS)

    expect(reduced.finish).not.toBeNull()
    expect(reduced.finish!.loopIndex).toBe(2)
    expect(reduced.finish!.bossesDefeatedForward).toBe(6)
    expect(reduced.finish!.pctIntoFinalStage).toBeCloseTo(0.83333, 4)
    expect(reduced.projectedForwardSpend).toBe(41)
    expect(reduced.confidence).toBe('medium')
  })

  it('prime allocation changes the finish ONLY in the intended direction', () => {
    const mainOnly = reduceSeasonOutlook(
      buildOutlookPayload(runFixturePlan(false)),
      REDUCE_OPTS
    )
    const withPrimes = reduceSeasonOutlook(
      buildOutlookPayload(runFixturePlan(true)),
      REDUCE_OPTS
    )

    expect(withPrimes.finish).not.toBeNull()
    expect(withPrimes.finish!.loopIndex).toBe(1)
    expect(withPrimes.finish!.bossesDefeatedForward).toBe(3)
    expect(withPrimes.finish!.bossesDefeatedForward).toBeLessThan(
      mainOnly.finish!.bossesDefeatedForward
    )

    expect(withPrimes.projectedForwardSpend).toBe(44)
    expect(withPrimes.projectedForwardSpend).toBeGreaterThan(
      mainOnly.projectedForwardSpend
    )
  })

  it('leaves the homepage token-economy tiles untouched by the planner change', () => {
    const mainOnly = reduceSeasonOutlook(
      buildOutlookPayload(runFixturePlan(false)),
      REDUCE_OPTS
    )
    const withPrimes = reduceSeasonOutlook(
      buildOutlookPayload(runFixturePlan(true)),
      REDUCE_OPTS
    )

    expect(withPrimes.tokensUsed).toBe(mainOnly.tokensUsed)
    expect(withPrimes.tokensRemaining).toBe(mainOnly.tokensRemaining)
    expect(withPrimes.projectedWaste).toBe(mainOnly.projectedWaste)
    expect(withPrimes.playersAtCapRisk).toBe(mainOnly.playersAtCapRisk)
    expect(withPrimes.seasonBudget).toBe(mainOnly.seasonBudget)
    expect(withPrimes.memberCount).toBe(mainOnly.memberCount)
    expect(withPrimes.confidence).toBe(mainOnly.confidence)
  })
})
