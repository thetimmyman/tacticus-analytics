/** Max 3 tokens, +1 per 12h, regen pauses at cap, no season grant; bombs 18h, max 1. */

interface TokenStatus {
  count: number
  refreshTime: number // Unix seconds when regeneration started
}

interface Battle {
  displayName: string
  damageType: 'Battle' | 'Bomb'
  startedOn: string | null
  completedOn?: string | null
}

interface TokenCalculationResult {
  tokensAvailable: number
  bombsAvailable: number
  tokenCooldown: string | null
  bombCooldown: string | null
  tokenNextSeconds?: number | null
  bombNextSeconds?: number | null
  dataSource: 'calculated'
  lastBattleTime?: string
  tokenStatus: TokenStatus
}

export const TWELVE_HOURS_IN_SECONDS = 12 * 60 * 60
export const EIGHTEEN_HOURS_IN_SECONDS = 18 * 60 * 60
export const MAX_TOKENS = 3
// Replay anchor, not a game grant: the floor of entry states {2, 3}; low self-heals at cap.
export const INITIAL_TOKENS = 2
export const SEASON_MAX_SPENDABLE_TOKENS = 28
export const SEASON_END_LOCKOUT_SECONDS = 15 * 60

function evaluateToken(
  token: TokenStatus,
  timestampInSeconds: number
): TokenStatus {
  if (token.count >= MAX_TOKENS) {
    return token
  }

  // Clamped: evaluating before the anchor must regen nothing.
  const nRecharged = Math.max(
    0,
    Math.floor(
      (timestampInSeconds - token.refreshTime) / TWELVE_HOURS_IN_SECONDS
    )
  )

  if (nRecharged + token.count >= MAX_TOKENS) {
    token.count = MAX_TOKENS
    token.refreshTime = timestampInSeconds
  } else {
    token.count += nRecharged
    token.refreshTime += nRecharged * TWELVE_HOURS_IN_SECONDS
  }

  return token
}

function secondsToString(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours === 0) {
    return `${minutes}m`
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

/** `seasonStart` anchors the replay; without it the first battle does, undercounting late starters. */
export function calculateTokenAvailability(
  battles: Battle[],
  seasonStart?: Date,
  currentTime: Date = new Date()
): TokenCalculationResult {
  const now = Math.floor(currentTime.getTime() / 1000)

  const tokenBattles = battles.filter(
    (battle): battle is Battle & { startedOn: string } =>
      battle.damageType === 'Battle' &&
      typeof battle.startedOn === 'string' &&
      battle.startedOn.length > 0
  )
  const bombBattles = battles.filter(
    (battle): battle is Battle & { startedOn: string } =>
      battle.damageType === 'Bomb' &&
      typeof battle.startedOn === 'string' &&
      battle.startedOn.length > 0
  )

  let bombsAvailable = 1
  let bombCooldown: string | null = null
  let bombNextSeconds: number | null = null
  if (bombBattles.length > 0) {
    const lastBombTimestamp = bombBattles.reduce((latest, battle) => {
      const t = Math.floor(new Date(battle.startedOn).getTime() / 1000)
      return t > latest ? t : latest
    }, 0)
    const timeSinceLastBomb = now - lastBombTimestamp
    if (timeSinceLastBomb < EIGHTEEN_HOURS_IN_SECONDS) {
      bombsAvailable = 0
      const remaining = EIGHTEEN_HOURS_IN_SECONDS - timeSinceLastBomb
      bombCooldown = secondsToString(remaining)
      bombNextSeconds = remaining
    }
  }

  const sortedTokenBattles = [...tokenBattles].sort((a, b) => {
    const aTime = new Date(a.startedOn).getTime()
    const bTime = new Date(b.startedOn).getTime()
    return aTime - bTime
  })

  let tokenStatus: TokenStatus

  if (sortedTokenBattles.length === 0) {
    if (seasonStart) {
      const seasonStartTimestamp = Math.floor(seasonStart.getTime() / 1000)

      tokenStatus = {
        count: INITIAL_TOKENS,
        refreshTime: seasonStartTimestamp
      }

      tokenStatus = evaluateToken(tokenStatus, now)
    } else {
      tokenStatus = {
        count: MAX_TOKENS,
        refreshTime: now
      }
    }

    let tokenCooldown: string | null = null
    if (tokenStatus.count < MAX_TOKENS) {
      const timeSinceRefresh = now - tokenStatus.refreshTime
      const timeUntilNextToken =
        TWELVE_HOURS_IN_SECONDS - (timeSinceRefresh % TWELVE_HOURS_IN_SECONDS)
      if (
        timeUntilNextToken > 0 &&
        timeUntilNextToken < TWELVE_HOURS_IN_SECONDS
      ) {
        tokenCooldown = secondsToString(timeUntilNextToken)
      }
    }

    return {
      tokensAvailable: Math.min(Math.max(0, tokenStatus.count), MAX_TOKENS),
      bombsAvailable,
      tokenCooldown,
      bombCooldown,
      bombNextSeconds,
      dataSource: 'calculated',
      tokenStatus
    }
  }

  // Battles predating seasonStart move the anchor back so regen never runs negative.
  const firstBattleTimestamp = Math.floor(
    new Date(sortedTokenBattles[0]?.startedOn ?? currentTime).getTime() / 1000
  )
  const anchorTimestamp = seasonStart
    ? Math.min(Math.floor(seasonStart.getTime() / 1000), firstBattleTimestamp)
    : firstBattleTimestamp
  tokenStatus = {
    count: INITIAL_TOKENS,
    refreshTime: anchorTimestamp
  }

  sortedTokenBattles.forEach((battle) => {
    const battleTimestamp = Math.floor(
      new Date(battle.startedOn).getTime() / 1000
    )

    tokenStatus = evaluateToken(tokenStatus, battleTimestamp)

    // Spending never resets the regen timer; a reset would diverge from the SQL replay.
    tokenStatus.count--
    if (tokenStatus.count < 0) {
      tokenStatus.count = 0
    }
  })

  tokenStatus = evaluateToken(tokenStatus, now)

  let tokenCooldown: string | null = null
  let tokenNextSeconds: number | null = null
  if (tokenStatus.count < MAX_TOKENS) {
    const timeSinceRefresh = now - tokenStatus.refreshTime
    const timeUntilNextToken =
      TWELVE_HOURS_IN_SECONDS - (timeSinceRefresh % TWELVE_HOURS_IN_SECONDS)
    if (
      timeUntilNextToken > 0 &&
      timeUntilNextToken < TWELVE_HOURS_IN_SECONDS
    ) {
      tokenCooldown = secondsToString(timeUntilNextToken)
      tokenNextSeconds = timeUntilNextToken
    }
  }

  return {
    tokensAvailable: Math.min(Math.max(0, tokenStatus.count), MAX_TOKENS),
    bombsAvailable,
    tokenCooldown,
    bombCooldown,
    tokenNextSeconds,
    bombNextSeconds,
    dataSource: 'calculated',
    lastBattleTime:
      sortedTokenBattles[sortedTokenBattles.length - 1]?.startedOn || undefined,
    tokenStatus
  }
}

export interface PlayerSyncData {
  last_sync_tokens: number | null
  last_sync_bombs: number | null
  last_sync_at: string | null
  api_key_is_valid: boolean | null
  tacticus_api_key_encrypted: string | null
}

export interface TokenAvailabilityResult {
  tokensAvailable: number
  bombsAvailable: number
  tokenNextSeconds: number | null
  bombNextSeconds: number | null
  dataSource: 'api' | 'calculated' | 'default'
}

/** Fallback for players without an API key. */
export function getTokenAvailability(
  _syncData: PlayerSyncData | null,
  battles: Battle[],
  seasonStartDate?: Date,
  now: Date = new Date()
): TokenAvailabilityResult {
  const calculated = calculateTokenAvailability(battles, seasonStartDate, now)
  return {
    tokensAvailable: calculated.tokensAvailable,
    bombsAvailable: calculated.bombsAvailable,
    tokenNextSeconds: calculated.tokenNextSeconds ?? null,
    bombNextSeconds: calculated.bombNextSeconds ?? null,
    dataSource: calculated.dataSource
  }
}

export function calculateGuildTokenAvailability(
  guildBattles: Battle[],
  seasonStart: Date
): Map<string, TokenCalculationResult> {
  const results = new Map<string, TokenCalculationResult>()

  const battlesByPlayer = new Map<string, Battle[]>()

  for (const battle of guildBattles) {
    const playerBattles = battlesByPlayer.get(battle.displayName) || []
    playerBattles.push(battle)
    battlesByPlayer.set(battle.displayName, playerBattles)
  }

  for (const [playerName, playerBattles] of battlesByPlayer) {
    const result = calculateTokenAvailability(playerBattles, seasonStart)
    results.set(playerName, result)
  }

  return results
}
