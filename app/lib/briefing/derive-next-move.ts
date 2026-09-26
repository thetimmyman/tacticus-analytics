/** Missing inputs give `unknown`; a bomb-range kill target overrides every token-spend branch. */

import type {
  BossTargetRef,
  MoveEconomy,
  NextMove,
  NextMoveAlternative,
  NextMoveReasonCode,
  PrimeTarget
} from './types'

export const VALUE_MARGIN = 0.1
export const DEFAULT_REGEN_SECONDS = 12 * 60 * 60

export interface NextMoveInput {
  hasClaimedProfile: boolean
  mainBoss: {
    name: string
    displayName: string
    levelCode: string
    encounterId: number
    hpPercentage: number
    remainingHp?: number | null
  } | null
  tokens: {
    current: number
    max: number
    nextInSeconds: number | null
  } | null
  bombs?: {
    current: number
    max: number
    nextInSeconds: number | null
  } | null
  /** Null/absent = unknown (no fallback). */
  bombDamagePerBomb?: number | null
  /** `[]` is an authoritative "nothing in range" and suppresses the single-bomb fallback. */
  bombRangeEncounterIds?: number[] | null
  guildBombsAvailable?: number | null
  mainWarded?: boolean | null
  /** undefined: unavailable, use `mainWarded`; `[]`: main is not warded. */
  primeTargets?: PrimeTarget[]
  currentBossValue?: number | null
  alternatives?: NextMoveAlternative[]
  regenSeconds?: number
  encounterHref: string
  sourceTimestamps?: Record<string, string>
}

// Deliberately not time-constants formatDurationMs: takes seconds, has prose fallbacks.
function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return 'soon'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    const rh = h % 24
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`
  }
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return '<1m'
}

function tokenFragment(tokens: NextMoveInput['tokens']): string {
  if (!tokens) return 'Tokens unknown'
  return `${tokens.current} / ${tokens.max} tokens`
}

function primeBehaviourSuffix(prime: PrimeTarget): string {
  if (
    prime.behaviour === 'threshold' &&
    typeof prime.thresholdHpPct === 'number'
  ) {
    return ` down to ${prime.thresholdHpPct}%`
  }
  return ''
}

export function isBombFinishable(
  remainingHp: number | null | undefined,
  bombDamagePerBomb: number | null | undefined
): boolean {
  if (typeof remainingHp !== 'number' || !Number.isFinite(remainingHp)) {
    return false
  }
  if (
    typeof bombDamagePerBomb !== 'number' ||
    !Number.isFinite(bombDamagePerBomb) ||
    bombDamagePerBomb <= 0
  ) {
    return false
  }
  return remainingHp > 0 && remainingHp <= bombDamagePerBomb
}

/** Null when the cap cannot be timed; callers must not recommend holding against it. */
export function timeToCapSeconds(
  tokens: NonNullable<NextMoveInput['tokens']>,
  regenSeconds: number
): number | null {
  if (tokens.current >= tokens.max) return 0
  if (tokens.nextInSeconds == null) return null
  return tokens.nextInSeconds + (tokens.max - tokens.current - 1) * regenSeconds
}

export function bestReachableAlternative(
  alternatives: NextMoveAlternative[],
  currentValue: number | null,
  timeToCap: number | null,
  margin: number
): NextMoveAlternative | null {
  if (currentValue == null || currentValue <= 0) return null
  if (timeToCap == null || timeToCap <= 0) return null
  const threshold = currentValue * (1 + margin)
  const reachable = alternatives.filter(
    (a) =>
      a.value != null &&
      a.value > threshold &&
      a.etaSeconds != null &&
      a.etaSeconds > 0 &&
      a.etaSeconds <= timeToCap
  )
  if (reachable.length === 0) return null
  return reachable.sort(
    (x, y) =>
      (y.value ?? 0) - (x.value ?? 0) ||
      (x.etaSeconds ?? 0) - (y.etaSeconds ?? 0)
  )[0]!
}

/** With >=2 tokens or a regen before the ETA they can do both, so holding wastes an attack. */
export function holdForfeitsAlternative(
  tokens: NonNullable<NextMoveInput['tokens']>,
  etaSeconds: number,
  regenSeconds: number
): boolean {
  const afterSpend = tokens.current - 1
  if (afterSpend >= 1) return false // still banked a token after attacking now
  const nextIn = tokens.nextInSeconds
  const regenByEta =
    nextIn != null && etaSeconds >= nextIn
      ? 1 + Math.floor((etaSeconds - nextIn) / regenSeconds)
      : 0
  return regenByEta < 1 // no token available by the ETA → must hold to hit it
}

export function deriveNextMove(input: NextMoveInput): NextMove {
  const sourceTimestamps = input.sourceTimestamps ?? {}
  const openEncounter = { label: 'Open encounter', href: input.encounterHref }
  const regenSeconds = input.regenSeconds ?? DEFAULT_REGEN_SECONDS

  if (!input.hasClaimedProfile) {
    return {
      state: 'setup_required',
      headline: 'Finish setting up your profile',
      detail:
        'Claim your player and add a Tacticus API key to get personalized attack guidance.',
      reasonCodes: ['profile_unclaimed'],
      confidence: 'high',
      primaryAction: { label: 'Set up profile', href: '/onboarding' },
      basis: [],
      sourceTimestamps
    }
  }

  if (!input.mainBoss) {
    return {
      state: 'unknown',
      headline: 'Live boss status unavailable',
      detail:
        "We couldn't load the current raid boss. Check the encounter page or try again shortly.",
      reasonCodes: ['no_boss_data'],
      confidence: 'low',
      primaryAction: openEncounter,
      basis: [],
      sourceTimestamps
    }
  }

  const boss = input.mainBoss
  const target = {
    name: boss.name,
    displayName: boss.displayName,
    levelCode: boss.levelCode,
    encounterId: boss.encounterId,
    hpPercentage: boss.hpPercentage
  }
  const mainAlive = boss.hpPercentage > 0

  if (!mainAlive) {
    return {
      state: 'done',
      headline: `${boss.displayName} is down`,
      detail:
        'The current main boss is defeated for this loop — wait for the next encounter or check the guild plan.',
      target,
      reasonCodes: ['main_defeated'],
      confidence: 'high',
      primaryAction: openEncounter,
      basis: [`${boss.displayName} ${boss.levelCode}`],
      sourceTimestamps
    }
  }

  const reasonCodes: NextMoveReasonCode[] = ['main_alive']
  const basis: string[] = [
    `${boss.displayName} ${boss.levelCode}`,
    tokenFragment(input.tokens)
  ]

  const tokensKnown = input.tokens != null
  const hasToken = (input.tokens?.current ?? 0) > 0

  const bombDamage = input.bombDamagePerBomb ?? null
  const bombsKnown = input.bombs != null
  const hasBomb = (input.bombs?.current ?? 0) > 0
  const liveComputed = input.bombRangeEncounterIds != null
  const guildBombRange = new Set(input.bombRangeEncounterIds ?? [])
  const inBombRange = (
    encounterId: number,
    remainingHp: number | null | undefined
  ): boolean =>
    guildBombRange.has(encounterId) ||
    (!liveComputed && isBombFinishable(remainingHp, bombDamage))
  const nextBombFragment = (): string => {
    const nextIn = input.bombs?.nextInSeconds
    return nextIn != null && nextIn > 0
      ? ` Your bomb is back in ${formatDuration(nextIn)}.`
      : ''
  }
  const pushBombMathBasis = (remainingHp: number | null | undefined): void => {
    if (
      typeof remainingHp === 'number' &&
      Number.isFinite(remainingHp) &&
      remainingHp > 0 &&
      bombDamage != null &&
      bombDamage > 0
    ) {
      const needed = Math.ceil(remainingHp / bombDamage)
      basis.push(`needs ~${needed} bomb${needed === 1 ? '' : 's'}`)
    }
    const available = input.guildBombsAvailable
    if (typeof available === 'number' && Number.isFinite(available)) {
      basis.push(`${available} guild bomb${available === 1 ? '' : 's'} in hand`)
    }
  }

  const liveTargets = input.primeTargets ?? []
  if (liveTargets.length > 0) {
    // Threshold primes stop at a %, so bombs don't apply to them.
    const bombable = liveTargets.filter(
      (t) => t.behaviour === 'kill' && inBombRange(t.encounterId, t.remainingHp)
    )
    const tokenTargets = liveTargets.filter((t) => !bombable.includes(t))

    if (tokenTargets.length === 0) {
      const top = bombable[0]!
      const primeRef: BossTargetRef = {
        name: top.name,
        displayName: top.displayName,
        levelCode: top.levelCode,
        encounterId: top.encounterId,
        hpPercentage: top.hpPercentage
      }
      const bombReasons: NextMoveReasonCode[] = [
        ...reasonCodes,
        'clear_primes',
        'bomb_range'
      ]
      const others =
        bombable.length > 1
          ? ` (${bombable
              .slice(1)
              .map((t) => t.displayName)
              .join(', ')} too)`
          : ''
      pushBombMathBasis(top.remainingHp)
      if (hasBomb) {
        basis.push('bomb ready')
        return {
          state: 'attack',
          headline: `Bomb ${top.displayName}`,
          detail: `${top.displayName} is down to ${Math.round(top.hpPercentage)}% — it's in bomb range${others}. Drop your guild bomb on it and save your raid token for the next boss.`,
          target: primeRef,
          primeTargets: liveTargets,
          reasonCodes: [...bombReasons, 'bomb_available'],
          confidence: 'high',
          primaryAction: openEncounter,
          basis,
          sourceTimestamps
        }
      }
      if (bombsKnown) {
        basis.push('bomb on cooldown')
        return {
          state: 'hold',
          headline: `Hold your token — ${top.displayName} is in bomb range`,
          detail: `${top.displayName} is in bomb range${others} — guild bombs will finish it. Don't spend a raid token on it; hold yours until it's bombed down.${nextBombFragment()}`,
          target: primeRef,
          primeTargets: liveTargets,
          reasonCodes: [...bombReasons, 'no_bomb'],
          confidence: 'high',
          primaryAction: openEncounter,
          basis,
          sourceTimestamps
        }
      }
      return {
        state: 'hold',
        headline: `Hold your token — ${top.displayName} is in bomb range`,
        detail: `${top.displayName} is in bomb range${others} — guild bombs will finish it. Don't spend a raid token on it — use your bomb if you have one.`,
        target: primeRef,
        primeTargets: liveTargets,
        reasonCodes: [...bombReasons, 'bomb_unknown'],
        confidence: 'medium',
        primaryAction: openEncounter,
        basis,
        sourceTimestamps
      }
    }

    const top = tokenTargets[0]!
    const primeRef: BossTargetRef = {
      name: top.name,
      displayName: top.displayName,
      levelCode: top.levelCode,
      encounterId: top.encounterId,
      hpPercentage: top.hpPercentage
    }
    const primeReasons: NextMoveReasonCode[] = [...reasonCodes, 'clear_primes']
    let bombNote = ''
    if (bombable.length > 0) {
      const names = bombable.map((t) => t.displayName).join(', ')
      primeReasons.push('bomb_range')
      if (hasBomb) {
        primeReasons.push('bomb_available')
        bombNote = ` ${names} is in bomb range — drop your guild bomb on it, don't spend a token there.`
      } else {
        bombNote = ` ${names} is in bomb range — leave it for guild bombs, don't spend a token there.`
      }
    }

    if (!tokensKnown) {
      return {
        state: 'unknown',
        headline: 'Check your raid tokens',
        detail: `The main is warded until the primes are down, but we couldn't read your token count. Open the encounter to confirm before attacking ${top.displayName}.${bombNote}`,
        target: primeRef,
        primeTargets: liveTargets,
        reasonCodes: [...primeReasons, 'token_unknown'],
        confidence: 'low',
        primaryAction: openEncounter,
        basis,
        sourceTimestamps
      }
    }
    const primeTokens = input.tokens!
    if (!hasToken) {
      const next = formatDuration(primeTokens.nextInSeconds ?? null)
      return {
        state: 'hold',
        headline: `No token — clear ${top.displayName} next`,
        detail: `The main is warded until the primes are down. You're out of guild-raid tokens; next in ${next}.${bombNote}`,
        target: primeRef,
        primeTargets: liveTargets,
        reasonCodes: [...primeReasons, 'no_token'],
        confidence: 'high',
        primaryAction: openEncounter,
        basis,
        sourceTimestamps
      }
    }
    return {
      state: 'attack',
      headline: `Clear ${top.displayName} first`,
      detail: `The main is warded until the primes are down. Spend a token on ${top.displayName}${primeBehaviourSuffix(top)}.${bombNote}`,
      target: primeRef,
      primeTargets: liveTargets,
      reasonCodes: [...primeReasons, 'token_available'],
      confidence: 'high',
      primaryAction: openEncounter,
      basis,
      sourceTimestamps
    }
  }

  if (input.primeTargets === undefined && input.mainWarded === true) {
    reasonCodes.push('main_warded')
    return {
      state: 'hold',
      headline: 'Hold — the main is warded',
      detail:
        'The main boss is locked until the active primes are defeated. Clear the primes first.',
      target,
      reasonCodes,
      confidence: 'high',
      primaryAction: openEncounter,
      basis,
      sourceTimestamps
    }
  }

  if (inBombRange(boss.encounterId, boss.remainingHp ?? null)) {
    reasonCodes.push('bomb_range')
    pushBombMathBasis(boss.remainingHp)
    if (hasBomb) {
      basis.push('bomb ready')
      return {
        state: 'attack',
        headline: `Bomb ${boss.displayName}`,
        detail: `${boss.displayName} is down to ${Math.round(boss.hpPercentage)}% — it's in bomb range. Drop your guild bomb on it and save your raid token for the next boss.`,
        target,
        reasonCodes: [...reasonCodes, 'bomb_available'],
        confidence: 'high',
        primaryAction: openEncounter,
        basis,
        sourceTimestamps
      }
    }
    if (bombsKnown) {
      basis.push('bomb on cooldown')
      return {
        state: 'hold',
        headline: `Hold your token — ${boss.displayName} is in bomb range`,
        detail: `${boss.displayName} is in bomb range — guild bombs will finish it. Don't spend a raid token on it; hold yours for the next boss.${nextBombFragment()}`,
        target,
        reasonCodes: [...reasonCodes, 'no_bomb'],
        confidence: 'high',
        primaryAction: openEncounter,
        basis,
        sourceTimestamps
      }
    }
    return {
      state: 'hold',
      headline: `Hold your token — ${boss.displayName} is in bomb range`,
      detail: `${boss.displayName} is in bomb range — guild bombs will finish it. Don't spend a raid token on it — use your bomb if you have one.`,
      target,
      reasonCodes: [...reasonCodes, 'bomb_unknown'],
      confidence: 'medium',
      primaryAction: openEncounter,
      basis,
      sourceTimestamps
    }
  }

  // Unknown token count: never assert "no token".
  if (!tokensKnown) {
    reasonCodes.push('token_unknown')
    return {
      state: 'unknown',
      headline: 'Check your raid tokens',
      detail:
        "We couldn't read your token count. Open the encounter to confirm before attacking.",
      target,
      reasonCodes,
      confidence: 'low',
      primaryAction: openEncounter,
      basis,
      sourceTimestamps
    }
  }

  const tokens = input.tokens!

  if (!hasToken) {
    reasonCodes.push('no_token')
    const next = formatDuration(tokens.nextInSeconds ?? null)
    return {
      state: 'hold',
      headline: 'No raid token available',
      detail: `You're out of guild-raid tokens. Next token in ${next}.`,
      target,
      reasonCodes,
      confidence: 'high',
      primaryAction: openEncounter,
      basis,
      sourceTimestamps
    }
  }

  reasonCodes.push('token_available')

  const currentValue = input.currentBossValue ?? null
  const alternatives = input.alternatives ?? []
  const evaluableAlts = alternatives.filter(
    (a) => a.value != null && a.etaSeconds != null
  )
  const atCap = tokens.current >= tokens.max
  const timeToCap = timeToCapSeconds(tokens, regenSeconds)
  const capLabel = atCap
    ? 'at token cap'
    : timeToCap != null
      ? `caps in ${formatDuration(timeToCap)}`
      : null
  if (capLabel) basis.push(capLabel)

  const economy: MoveEconomy = { currentValue, capLabel }

  if (atCap) {
    reasonCodes.push('token_at_cap')
    return {
      state: 'attack',
      headline: `Attack ${boss.displayName} now`,
      detail: `You're at your token cap — spend it on ${boss.displayName} now or you forfeit token regeneration.`,
      target,
      reasonCodes,
      confidence: 'high',
      primaryAction: openEncounter,
      basis,
      economy,
      sourceTimestamps
    }
  }

  const bestAlt = bestReachableAlternative(
    alternatives,
    currentValue,
    timeToCap,
    VALUE_MARGIN
  )
  if (bestAlt && currentValue != null && bestAlt.value != null) {
    const upliftPct = ((bestAlt.value - currentValue) / currentValue) * 100
    const etaLabel = `~${formatDuration(bestAlt.etaSeconds)}`
    if (
      holdForfeitsAlternative(tokens, bestAlt.etaSeconds ?? 0, regenSeconds)
    ) {
      reasonCodes.push('stronger_target_soon')
      economy.waitFor = {
        displayName: bestAlt.displayName,
        levelCode: bestAlt.levelCode,
        upliftPct,
        etaLabel,
        etaSource: bestAlt.etaSource
      }
      return {
        state: 'hold',
        headline: `Hold for ${bestAlt.displayName}`,
        detail: `You hit ${bestAlt.displayName} about ${Math.round(upliftPct)}% harder, and the guild should reach it in ${etaLabel} — before your token ${capLabel ?? 'caps'}. Hold this token for it.`,
        target,
        reasonCodes,
        confidence: bestAlt.etaSource === 'history' ? 'high' : 'medium',
        primaryAction: openEncounter,
        basis,
        economy,
        sourceTimestamps
      }
    }
    reasonCodes.push('best_target_now')
    return {
      state: 'attack',
      headline: `Attack ${boss.displayName} now`,
      detail: `Spend a token on ${boss.displayName} now — you'll still have one for ${bestAlt.displayName} (${Math.round(upliftPct)}% harder, ${etaLabel}) when the guild reaches it.`,
      target,
      reasonCodes,
      confidence: 'high',
      primaryAction: openEncounter,
      basis,
      economy,
      sourceTimestamps
    }
  }

  if (currentValue != null) {
    reasonCodes.push('best_target_now')
    const couldCompare = evaluableAlts.length > 0
    if (!couldCompare) reasonCodes.push('pace_unknown')
    return {
      state: 'attack',
      headline: `Attack ${boss.displayName} now`,
      detail: couldCompare
        ? `${boss.displayName} is the strongest target you can reach before your token ${capLabel ?? 'caps'} — no upcoming boss beats it in time. Spend your token here.`
        : `You have a token and ${boss.displayName} is up — a strong target for you. We can't project upcoming bosses right now, so spend it here.`,
      target,
      reasonCodes,
      confidence: couldCompare ? 'high' : 'medium',
      primaryAction: openEncounter,
      basis,
      economy,
      sourceTimestamps
    }
  }

  reasonCodes.push('value_unknown')
  if (evaluableAlts.length === 0) reasonCodes.push('pace_unknown')
  return {
    state: 'unknown',
    headline: 'Raid token ready',
    detail: `You have a guild-raid token and ${boss.displayName} is up, but we don't have enough of your attack history to rank this target. Open the encounter to decide.`,
    target,
    reasonCodes,
    confidence: 'low',
    primaryAction: openEncounter,
    basis,
    economy,
    sourceTimestamps
  }
}
