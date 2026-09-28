import { describe, it, expect } from 'vitest'
import {
  deriveNextMove,
  timeToCapSeconds,
  bestReachableAlternative,
  holdForfeitsAlternative,
  DEFAULT_REGEN_SECONDS,
  VALUE_MARGIN,
  type NextMoveInput
} from '@/app/lib/briefing/derive-next-move'
import {
  isStale,
  FRESHNESS_LIMITS_MS,
  type NextMoveAlternative
} from '@/app/lib/briefing/types'

const aliveBoss: NonNullable<NextMoveInput['mainBoss']> = {
  name: 'Magnus',
  displayName: 'Magnus the Red',
  levelCode: 'M1',
  encounterId: 0,
  hpPercentage: 67
}

const HOUR = 3600

function alt(over: Partial<NextMoveAlternative> = {}): NextMoveAlternative {
  return {
    name: 'tervigon',
    displayName: 'Tervigon',
    levelCode: 'M2',
    encounterId: 0,
    value: 150_000,
    etaSeconds: 10 * HOUR,
    etaSource: 'history',
    ...over
  }
}

function base(overrides: Partial<NextMoveInput> = {}): NextMoveInput {
  return {
    hasClaimedProfile: true,
    mainBoss: aliveBoss,
    tokens: { current: 1, max: 3, nextInSeconds: 6 * HOUR },
    currentBossValue: 100_000,
    alternatives: [],
    encounterHref: '/boss-playbooks',
    ...overrides
  }
}

describe('deriveNextMove — guards', () => {
  it('pre-claim profile → setup_required', () => {
    const m = deriveNextMove(base({ hasClaimedProfile: false }))
    expect(m.state).toBe('setup_required')
    expect(m.reasonCodes).toContain('profile_unclaimed')
    expect(m.primaryAction?.href).toBe('/onboarding')
  })

  it('no live boss data → unknown', () => {
    const m = deriveNextMove(base({ mainBoss: null }))
    expect(m.state).toBe('unknown')
    expect(m.reasonCodes).toContain('no_boss_data')
    expect(m.confidence).toBe('low')
  })

  it('main defeated (hp 0) → done', () => {
    const m = deriveNextMove(
      base({ mainBoss: { ...aliveBoss, hpPercentage: 0 } })
    )
    expect(m.state).toBe('done')
    expect(m.reasonCodes).toContain('main_defeated')
    expect(m.economy).toBeUndefined()
  })

  it('warded main → hold (never attack a warded main)', () => {
    const m = deriveNextMove(base({ mainWarded: true, alternatives: [alt()] }))
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('main_warded')
  })

  it('no token → hold with next-token time', () => {
    const m = deriveNextMove(
      base({
        tokens: { current: 0, max: 3, nextInSeconds: 6 * HOUR + 20 * 60 }
      })
    )
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('no_token')
    expect(m.detail).toContain('6h 20m')
    expect(m.economy).toBeUndefined()
  })

  it('absent token data → unknown (not a false "No raid token")', () => {
    const m = deriveNextMove(base({ tokens: null }))
    expect(m.state).toBe('unknown')
    expect(m.reasonCodes).toContain('token_unknown')
    expect(m.reasonCodes).not.toContain('no_token')
    expect(m.headline).not.toMatch(/No raid token/i)
    expect(m.economy).toBeUndefined()
  })
})

describe('deriveNextMove — live primes (playbook ward)', () => {
  const liveKillPrime = {
    encounterId: 1 as const,
    name: 'Szarekh',
    displayName: 'Prime One',
    levelCode: 'M2',
    hpPercentage: 64,
    remainingHp: 640_000,
    behaviour: 'kill' as const,
    thresholdHpPct: null
  }

  it('live prime + token → attack the prime (clear_primes), target is the prime', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [liveKillPrime],
        tokens: { current: 1, max: 3, nextInSeconds: 6 * HOUR }
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('clear_primes')
    expect(m.reasonCodes).not.toContain('main_warded')
    expect(m.target?.encounterId).toBe(1)
    expect(m.target?.displayName).toBe('Prime One')
    expect(m.primeTargets).toHaveLength(1)
    expect(m.headline).toMatch(/Prime One/)
  })

  it('threshold prime → attack mentions the stop-at threshold', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [
          { ...liveKillPrime, behaviour: 'threshold', thresholdHpPct: 20 }
        ]
      })
    )
    expect(m.state).toBe('attack')
    expect(m.detail).toMatch(/down to 20%/)
  })

  it('live prime + no token → hold targeting the prime', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [liveKillPrime],
        tokens: { current: 0, max: 3, nextInSeconds: 2 * HOUR }
      })
    )
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('clear_primes')
    expect(m.reasonCodes).toContain('no_token')
    expect(m.target?.encounterId).toBe(1)
    expect(m.detail).toMatch(/2h/)
  })

  it('resolved-but-empty primeTargets + warded → treat as NOT warded (main path)', () => {
    const m = deriveNextMove(base({ primeTargets: [], mainWarded: true }))
    expect(m.state).not.toBe('hold')
    expect(m.reasonCodes).not.toContain('main_warded')
    expect(m.reasonCodes).not.toContain('clear_primes')
    expect(m.target?.encounterId).toBe(0)
  })

  it('undefined primeTargets + warded → legacy warded hold (unchanged)', () => {
    const m = deriveNextMove(base({ mainWarded: true }))
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('main_warded')
    expect(m.reasonCodes).not.toContain('clear_primes')
  })
})

describe('deriveNextMove — bomb range', () => {
  const BOMB_DMG = 13_110
  const bombablePrime = {
    encounterId: 1 as const,
    name: 'TanGida',
    displayName: "Tan Gi'da",
    levelCode: 'M1',
    hpPercentage: 4,
    remainingHp: 12_000,
    behaviour: 'kill' as const,
    thresholdHpPct: null
  }
  const tokenPrime = {
    encounterId: 2 as const,
    name: 'Actus',
    displayName: 'Actus',
    levelCode: 'M1',
    hpPercentage: 7,
    remainingHp: 21_000,
    behaviour: 'kill' as const,
    thresholdHpPct: null
  }

  it('bombable prime + bomb in hand → recommend the bomb, never a token spend', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('attack')
    expect(m.headline).toBe("Bomb Tan Gi'da")
    expect(m.detail).not.toMatch(/Spend a token/i)
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['clear_primes', 'bomb_range', 'bomb_available'])
    )
    expect(m.target?.encounterId).toBe(1)
    expect(m.confidence).toBe('high')
  })

  it('bombable prime + bomb on cooldown → hold the token until it is bombed down', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombs: { current: 0, max: 1, nextInSeconds: 7 * HOUR },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('hold')
    expect(m.headline).toMatch(/bomb range/i)
    expect(m.detail).toMatch(/bombed down/i)
    expect(m.detail).toMatch(/7h/)
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['bomb_range', 'no_bomb'])
    )
    expect(m.confidence).toBe('high')
  })

  it('bombable prime + unknown bomb state → cautious hold (never a token spend)', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['bomb_range', 'bomb_unknown'])
    )
    expect(m.confidence).toBe('medium')
  })

  it('mixed primes: token goes to the non-bombable one, bomb note names the other', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime, tokenPrime],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('attack')
    expect(m.target?.displayName).toBe('Actus')
    expect(m.detail).toMatch(/Spend a token on Actus/)
    expect(m.detail).toMatch(/Tan Gi'da is in bomb range/)
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['bomb_range', 'bomb_available'])
    )
    expect(m.primeTargets).toHaveLength(2)
  })

  it('threshold prime at low HP is NOT a bomb target (pushed to a stop-at %, not killed)', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [
          {
            ...bombablePrime,
            behaviour: 'threshold' as const,
            thresholdHpPct: 2
          }
        ],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).not.toContain('bomb_range')
    expect(m.detail).toMatch(/down to 2%/)
  })

  it('unknown per-bomb damage → bomb detection skipped (legacy token recommendation)', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombs: { current: 1, max: 1, nextInSeconds: null }
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).not.toContain('bomb_range')
    expect(m.detail).toMatch(/Spend a token/)
  })

  it('main in bomb range + bomb in hand → bomb the main', () => {
    const m = deriveNextMove(
      base({
        mainBoss: { ...aliveBoss, hpPercentage: 3, remainingHp: 9_000 },
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('attack')
    expect(m.headline).toBe('Bomb Magnus the Red')
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['bomb_range', 'bomb_available'])
    )
  })

  it('main in bomb range + no bomb → hold the token (supersedes at-cap spend)', () => {
    const m = deriveNextMove(
      base({
        mainBoss: { ...aliveBoss, hpPercentage: 3, remainingHp: 9_000 },
        tokens: { current: 3, max: 3, nextInSeconds: 12 * HOUR },
        bombs: { current: 0, max: 1, nextInSeconds: 2 * HOUR },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('bomb_range')
    expect(m.reasonCodes).toContain('no_bomb')
    expect(m.reasonCodes).not.toContain('token_at_cap')
  })

  it('main above one-bomb damage → normal token flow', () => {
    const m = deriveNextMove(
      base({
        mainBoss: { ...aliveBoss, hpPercentage: 20, remainingHp: 60_000 },
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).not.toContain('bomb_range')
    expect(m.reasonCodes).toContain('best_target_now')
  })

  it('main with unknown absolute HP → bomb detection skipped', () => {
    const m = deriveNextMove(
      base({
        mainBoss: { ...aliveBoss, hpPercentage: 3 },
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.reasonCodes).not.toContain('bomb_range')
  })

  it('herald-flagged prime above single-bomb damage → still a bomb target, never a token spend', () => {
    const multiBombPrime = { ...bombablePrime, remainingHp: 45_000 }
    const m = deriveNextMove(
      base({
        primeTargets: [multiBombPrime],
        bombs: { current: 0, max: 1, nextInSeconds: 5 * HOUR },
        bombDamagePerBomb: BOMB_DMG,
        bombRangeEncounterIds: [1]
      })
    )
    expect(m.state).toBe('hold')
    expect(m.headline).toMatch(/bomb range/i)
    expect(m.detail).not.toMatch(/Spend a token/i)
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['bomb_range', 'no_bomb'])
    )
  })

  // A computed empty list is authoritative; a stale Herald breach row must not overrule it.
  it('67%-HP prime with a computed empty flag list → token target, never a bomb call', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [
          { ...bombablePrime, hpPercentage: 67, remainingHp: 1_206_000 }
        ],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG,
        bombRangeEncounterIds: [],
        guildBombsAvailable: 19
      })
    )
    expect(m.state).toBe('attack')
    expect(m.headline).not.toMatch(/^Bomb/)
    expect(m.detail).toMatch(/Spend a token/)
    expect(m.reasonCodes).not.toContain('bomb_range')
  })

  it('computed empty flags suppress the single-bomb fallback (zero guild bombs case)', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombs: { current: 0, max: 1, nextInSeconds: 5 * HOUR },
        bombDamagePerBomb: BOMB_DMG,
        bombRangeEncounterIds: [],
        guildBombsAvailable: 0
      })
    )
    expect(m.reasonCodes).not.toContain('bomb_range')
    expect(m.detail).toMatch(/Spend a token/)
  })

  it('single-bomb fallback still applies when the live computation was unavailable', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.state).toBe('attack')
    expect(m.headline).toBe("Bomb Tan Gi'da")
  })

  it('herald flag works without per-bomb damage data (bombDamagePerBomb null)', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [{ ...bombablePrime, remainingHp: 45_000 }],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombRangeEncounterIds: [1]
      })
    )
    expect(m.state).toBe('attack')
    expect(m.headline).toBe("Bomb Tan Gi'da")
    expect(m.reasonCodes).toEqual(
      expect.arrayContaining(['bomb_range', 'bomb_available'])
    )
  })

  it('herald flag for a different encounter does not mark this prime', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [{ ...bombablePrime, remainingHp: 45_000 }],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG,
        bombRangeEncounterIds: [2]
      })
    )
    expect(m.reasonCodes).not.toContain('bomb_range')
    expect(m.detail).toMatch(/Spend a token/)
  })

  it('bomb branches surface the auditable math in the basis line', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [{ ...bombablePrime, remainingHp: 45_000 }],
        bombs: { current: 0, max: 1, nextInSeconds: 5 * HOUR },
        bombDamagePerBomb: BOMB_DMG,
        bombRangeEncounterIds: [1],
        guildBombsAvailable: 9
      })
    )
    expect(m.basis).toEqual(
      expect.arrayContaining(['needs ~4 bombs', '9 guild bombs in hand'])
    )
  })

  it('basis math degrades gracefully when bombs-in-hand is unknown', () => {
    const m = deriveNextMove(
      base({
        primeTargets: [bombablePrime],
        bombs: { current: 1, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG
      })
    )
    expect(m.basis).toEqual(expect.arrayContaining(['needs ~1 bomb']))
    expect(m.basis.join(' ')).not.toMatch(/in hand/)
  })

  it('herald-flagged MAIN → bomb/hold instead of any token spend', () => {
    const m = deriveNextMove(
      base({
        mainBoss: { ...aliveBoss, hpPercentage: 9, remainingHp: 120_000 },
        tokens: { current: 3, max: 3, nextInSeconds: 12 * HOUR },
        bombs: { current: 0, max: 1, nextInSeconds: null },
        bombDamagePerBomb: BOMB_DMG,
        bombRangeEncounterIds: [0]
      })
    )
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('bomb_range')
    expect(m.reasonCodes).not.toContain('token_at_cap')
  })
})

describe('deriveNextMove — value / opportunity-cost', () => {
  it('at token cap → attack now (spending dominates holding), even with a stronger alt', () => {
    const m = deriveNextMove(
      base({
        tokens: { current: 3, max: 3, nextInSeconds: 12 * HOUR },
        alternatives: [alt({ value: 999_999, etaSeconds: 2 * HOUR })]
      })
    )
    expect(m.state).toBe('attack')
    expect(m.confidence).toBe('high')
    expect(m.reasonCodes).toContain('token_at_cap')
    expect(m.economy?.capLabel).toBe('at token cap')
    expect(m.economy?.waitFor).toBeFalsy()
  })

  it('the CAP STATE is what flips an otherwise-viable hold to attack', () => {
    const strongAlt = alt({ value: 999_999, etaSeconds: 5 * HOUR })
    const below = deriveNextMove(
      base({
        tokens: { current: 1, max: 3, nextInSeconds: 6 * HOUR },
        alternatives: [strongAlt]
      })
    )
    expect(below.state).toBe('hold')
    expect(below.reasonCodes).toContain('stronger_target_soon')
    const atCap = deriveNextMove(
      base({
        tokens: { current: 3, max: 3, nextInSeconds: 12 * HOUR },
        alternatives: [strongAlt]
      })
    )
    expect(atCap.state).toBe('attack')
    expect(atCap.reasonCodes).toContain('token_at_cap')
  })

  it('single token, stronger boss reachable BEFORE the next regen → hold for it', () => {
    const m = deriveNextMove(
      base({ alternatives: [alt({ value: 150_000, etaSeconds: 5 * HOUR })] })
    )
    expect(m.state).toBe('hold')
    expect(m.reasonCodes).toContain('stronger_target_soon')
    expect(m.confidence).toBe('high')
    expect(m.headline).toBe('Hold for Tervigon')
    expect(m.economy?.waitFor?.displayName).toBe('Tervigon')
    expect(Math.round(m.economy?.waitFor?.upliftPct ?? 0)).toBe(50)
  })

  it('estimate-backed ETA softens hold confidence to medium', () => {
    const m = deriveNextMove(
      base({
        alternatives: [
          alt({ value: 150_000, etaSeconds: 5 * HOUR, etaSource: 'estimate' })
        ]
      })
    )
    expect(m.state).toBe('hold')
    expect(m.confidence).toBe('medium')
  })

  it('multi-token bank: attack now AND keep a token for the stronger boss (no wrong hold)', () => {
    const m = deriveNextMove(
      base({
        tokens: { current: 2, max: 3, nextInSeconds: 6 * HOUR },
        alternatives: [alt({ value: 150_000, etaSeconds: 5 * HOUR })]
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.reasonCodes).not.toContain('stronger_target_soon')
    expect(m.detail).toContain('Tervigon')
  })

  it('single token but a regen ARRIVES before the alt → attack now (still hit it later)', () => {
    const m = deriveNextMove(
      base({
        tokens: { current: 1, max: 3, nextInSeconds: 3 * HOUR },
        alternatives: [alt({ value: 150_000, etaSeconds: 5 * HOUR })]
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.reasonCodes).not.toContain('stronger_target_soon')
  })

  it('stronger boss NOT reachable before cap → attack now', () => {
    const m = deriveNextMove(
      base({ alternatives: [alt({ value: 150_000, etaSeconds: 20 * HOUR })] })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.confidence).toBe('high')
  })

  it('alt within the equivalence margin is not "stronger" → attack now', () => {
    const m = deriveNextMove(
      base({ alternatives: [alt({ value: 105_000, etaSeconds: 4 * HOUR })] })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.reasonCodes).not.toContain('stronger_target_soon')
  })

  it('current value known but no upcoming targets to compare → attack (medium, pace_unknown)', () => {
    const m = deriveNextMove(base({ alternatives: [] }))
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.reasonCodes).toContain('pace_unknown')
    expect(m.confidence).toBe('medium')
  })

  it('alt with unknown value cannot drive a hold → attack (pace_unknown)', () => {
    const m = deriveNextMove(
      base({ alternatives: [alt({ value: null, etaSeconds: 4 * HOUR })] })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.reasonCodes).toContain('pace_unknown')
  })

  it('untimed cap (nextInSeconds null, below max) never recommends holding', () => {
    const m = deriveNextMove(
      base({
        tokens: { current: 1, max: 3, nextInSeconds: null },
        alternatives: [alt({ value: 999_999, etaSeconds: 1 * HOUR })]
      })
    )
    expect(m.state).toBe('attack')
    expect(m.reasonCodes).toContain('best_target_now')
    expect(m.economy?.capLabel).toBeNull()
  })

  it('no per-boss history for the current target → honest unknown', () => {
    const m = deriveNextMove(base({ currentBossValue: null }))
    expect(m.state).toBe('unknown')
    expect(m.reasonCodes).toContain('value_unknown')
    expect(m.confidence).toBe('low')
    expect(m.headline).toBe('Raid token ready')
  })

  it('basis includes boss, tokens, and the token-cap clock', () => {
    const m = deriveNextMove(base())
    expect(m.basis).toEqual(
      expect.arrayContaining([
        'Magnus the Red M1',
        '1 / 3 tokens',
        'caps in 18h'
      ])
    )
  })
})

describe('timeToCapSeconds', () => {
  it('0 at/over cap', () => {
    expect(
      timeToCapSeconds(
        { current: 3, max: 3, nextInSeconds: 100 },
        DEFAULT_REGEN_SECONDS
      )
    ).toBe(0)
  })
  it('null when next-token time is unknown and below cap', () => {
    expect(
      timeToCapSeconds(
        { current: 1, max: 3, nextInSeconds: null },
        DEFAULT_REGEN_SECONDS
      )
    ).toBeNull()
  })
  it('next token + full regens for the remaining headroom', () => {
    expect(
      timeToCapSeconds(
        { current: 1, max: 3, nextInSeconds: 6 * HOUR },
        DEFAULT_REGEN_SECONDS
      )
    ).toBe(6 * HOUR + 12 * HOUR)
  })
})

describe('bestReachableAlternative', () => {
  it('returns null when current value is unknown', () => {
    expect(
      bestReachableAlternative([alt()], null, 18 * HOUR, VALUE_MARGIN)
    ).toBeNull()
  })
  it('returns null when the cap horizon is unknown', () => {
    expect(
      bestReachableAlternative([alt()], 100_000, null, VALUE_MARGIN)
    ).toBeNull()
  })
  it('picks the highest-value alt reachable before the cap', () => {
    const best = bestReachableAlternative(
      [
        alt({ displayName: 'A', value: 130_000, etaSeconds: 4 * HOUR }),
        alt({ displayName: 'B', value: 170_000, etaSeconds: 8 * HOUR }),
        alt({ displayName: 'C', value: 999_999, etaSeconds: 40 * HOUR })
      ],
      100_000,
      18 * HOUR,
      VALUE_MARGIN
    )
    expect(best?.displayName).toBe('B')
  })
  it('excludes alts within the equivalence margin', () => {
    expect(
      bestReachableAlternative(
        [alt({ value: 108_000, etaSeconds: 4 * HOUR })],
        100_000,
        18 * HOUR,
        VALUE_MARGIN
      )
    ).toBeNull()
  })
})

describe('holdForfeitsAlternative', () => {
  it('≥2 tokens → never forfeits (you can take both)', () => {
    expect(
      holdForfeitsAlternative(
        { current: 2, max: 3, nextInSeconds: 6 * HOUR },
        5 * HOUR,
        DEFAULT_REGEN_SECONDS
      )
    ).toBe(false)
  })
  it('single token, regen lands AFTER the alt → forfeits (must hold)', () => {
    expect(
      holdForfeitsAlternative(
        { current: 1, max: 3, nextInSeconds: 6 * HOUR },
        5 * HOUR,
        DEFAULT_REGEN_SECONDS
      )
    ).toBe(true)
  })
  it('single token, regen lands BEFORE the alt → does not forfeit (attack now)', () => {
    expect(
      holdForfeitsAlternative(
        { current: 1, max: 3, nextInSeconds: 3 * HOUR },
        5 * HOUR,
        DEFAULT_REGEN_SECONDS
      )
    ).toBe(false)
  })
  it('single token, no regen timing known → forfeits (cannot guarantee a token by the ETA)', () => {
    expect(
      holdForfeitsAlternative(
        { current: 1, max: 3, nextInSeconds: null },
        5 * HOUR,
        DEFAULT_REGEN_SECONDS
      )
    ).toBe(true)
  })
})

describe('isStale', () => {
  const now = Date.parse('2026-06-18T12:00:00.000Z')

  it('treats null/invalid timestamps as stale', () => {
    expect(isStale(null, FRESHNESS_LIMITS_MS.tokens, now)).toBe(true)
    expect(isStale('not-a-date', FRESHNESS_LIMITS_MS.tokens, now)).toBe(true)
  })

  it('fresh within the limit, stale beyond it', () => {
    const fresh = new Date(now - 60_000).toISOString()
    const old = new Date(now - FRESHNESS_LIMITS_MS.tokens - 1_000).toISOString()
    expect(isStale(fresh, FRESHNESS_LIMITS_MS.tokens, now)).toBe(false)
    expect(isStale(old, FRESHNESS_LIMITS_MS.tokens, now)).toBe(true)
  })
})
