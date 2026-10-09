import {
  calculateTokenAvailability,
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS,
  SEASON_MAX_SPENDABLE_TOKENS
} from '@/app/lib/calculations/token-calculation'
import {
  advanceStamina,
  spendStamina,
  type StaminaState
} from './season-planner/stamina-simulator'

export interface SavedTokenBattle {
  displayName: string
  damageType: 'Battle' | 'Bomb'
  startedOn: string
}

export interface SavedQueueTemporalInput {
  asOfMs: number
  seasonEndMs: number
  players: readonly {
    playerId: string
    state: StaminaState
    usedThisSeason: number
  }[]
  stages: readonly {
    stageCode: string
    loopIndex: number
    startSeconds: number
    allocations: readonly { playerId: string; tokens: number }[]
  }[]
}

export type SavedQueueTemporalResult =
  | { feasible: true }
  | {
      feasible: false
      reason:
        | 'invalid-model'
        | 'outside-season'
        | 'insufficient-tokens'
        | 'season-token-limit'
    }

const MAX_HISTORY_ROWS = 10000
const MAX_PLAYERS = 30
const MAX_STAGES = 50
const MAX_ALLOCATIONS_PER_STAGE = MAX_PLAYERS * 3
const REGEN_MS = TWELVE_HOURS_IN_SECONDS * 1000

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function instant(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  )
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function historyTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const parts =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value
    )
  if (
    !parts ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4]) > 59 ||
    Number(parts[5] ?? 0) > 23 ||
    Number(parts[6] ?? 0) > 59
  )
    return null
  const calendar = new Date(`${parts[1]}T00:00:00Z`)
  const at = Date.parse(value)
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== parts[1] ||
    !instant(at)
  )
    return null
  return at
}

function playerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

/** Preserve the canonical replay clock, including the no-battle branch. */
export function initialSavedTokenState(args: {
  seasonStartMs: number
  asOfMs: number
  battles: readonly SavedTokenBattle[]
}): StaminaState {
  const invalid = () => {
    throw new Error('Invalid saved token history')
  }
  if (
    !record(args) ||
    !instant(args.seasonStartMs) ||
    !instant(args.asOfMs) ||
    args.seasonStartMs > args.asOfMs ||
    !Array.isArray(args.battles) ||
    args.battles.length > MAX_HISTORY_ROWS
  )
    return invalid()
  for (const battle of args.battles) {
    if (
      !record(battle) ||
      typeof battle.displayName !== 'string' ||
      battle.displayName.length > 1024 ||
      (battle.damageType !== 'Battle' && battle.damageType !== 'Bomb')
    )
      return invalid()
    const at = historyTime(battle.startedOn)
    if (at === null || at < args.seasonStartMs || at > args.asOfMs)
      return invalid()
  }
  const replay = calculateTokenAvailability(
    [...args.battles],
    new Date(args.seasonStartMs),
    new Date(args.asOfMs)
  )
  return {
    available: replay.tokenStatus.count,
    nextRegenAt:
      replay.tokenStatus.count >= MAX_TOKENS
        ? null
        : (replay.tokenStatus.refreshTime + TWELVE_HOURS_IN_SECONDS) * 1000
  }
}

/** Refuse the whole allocation when canonical stamina replay cannot spend it.
 * Stage starts must be representable by the preview's millisecond ISO times.
 * This checks token feasibility at those projected instants, not actual future
 * boss clearance or attendance. It neither changes nor reallocates input. */
export function verifySavedQueueTemporalAllocation(
  args: SavedQueueTemporalInput
): SavedQueueTemporalResult {
  const invalid: SavedQueueTemporalResult = {
    feasible: false,
    reason: 'invalid-model'
  }
  if (
    !record(args) ||
    !instant(args.asOfMs) ||
    !instant(args.seasonEndMs) ||
    args.seasonEndMs <= args.asOfMs ||
    !Array.isArray(args.players) ||
    args.players.length > MAX_PLAYERS ||
    !Array.isArray(args.stages) ||
    args.stages.length > MAX_STAGES
  )
    return invalid
  const settings = {
    max: MAX_TOKENS,
    regenerationSeconds: TWELVE_HOURS_IN_SECONDS,
    amountPerTick: 1
  }
  const players = new Map<
    string,
    { state: StaminaState; at: number; spent: number }
  >()
  for (const player of args.players) {
    if (
      !record(player) ||
      !playerId(player.playerId) ||
      players.has(player.playerId) ||
      !record(player.state) ||
      !integer(player.state.available) ||
      player.state.available < 0 ||
      player.state.available > MAX_TOKENS ||
      !integer(player.usedThisSeason) ||
      player.usedThisSeason < 0 ||
      player.usedThisSeason > MAX_HISTORY_ROWS
    )
      return invalid
    let state: StaminaState
    if (player.state.available === MAX_TOKENS) {
      if (player.state.nextRegenAt !== null) return invalid
      state = { available: player.state.available, nextRegenAt: null }
    } else {
      if (
        !instant(player.state.nextRegenAt) ||
        player.state.nextRegenAt <= args.asOfMs ||
        player.state.nextRegenAt > args.asOfMs + REGEN_MS
      )
        return invalid
      state = {
        available: player.state.available,
        nextRegenAt: player.state.nextRegenAt
      }
    }
    if (player.usedThisSeason > SEASON_MAX_SPENDABLE_TOKENS)
      return { feasible: false, reason: 'season-token-limit' }
    players.set(player.playerId, {
      state,
      at: args.asOfMs,
      spent: player.usedThisSeason
    })
  }
  let previousAt = args.asOfMs
  const identities = new Set<string>()
  for (const stage of args.stages) {
    if (
      !record(stage) ||
      typeof stage.stageCode !== 'string' ||
      !/^[ML][1-5]$/.test(stage.stageCode) ||
      !integer(stage.loopIndex) ||
      stage.loopIndex < 0 ||
      typeof stage.startSeconds !== 'number' ||
      !Number.isFinite(stage.startSeconds) ||
      !Number.isSafeInteger(stage.startSeconds * 1000) ||
      stage.startSeconds < 0 ||
      !Array.isArray(stage.allocations) ||
      stage.allocations.length > MAX_ALLOCATIONS_PER_STAGE
    )
      return invalid
    const at = args.asOfMs + stage.startSeconds * 1000
    const identity = `${stage.stageCode}:${stage.loopIndex}`
    if (!instant(at) || at < previousAt || identities.has(identity))
      return invalid
    if (at >= args.seasonEndMs)
      return { feasible: false, reason: 'outside-season' }
    previousAt = at
    identities.add(identity)
    const totals = new Map<string, number>()
    for (const allocation of stage.allocations) {
      if (
        !record(allocation) ||
        !playerId(allocation.playerId) ||
        !players.has(allocation.playerId) ||
        !integer(allocation.tokens) ||
        allocation.tokens < 0 ||
        allocation.tokens > SEASON_MAX_SPENDABLE_TOKENS
      )
        return invalid
      totals.set(
        allocation.playerId,
        (totals.get(allocation.playerId) ?? 0) + allocation.tokens
      )
    }
    for (const [playerId, amount] of totals) {
      const player = players.get(playerId)!
      player.state = advanceStamina({
        state: player.state,
        settings,
        from: player.at,
        to: at
      }).state
      if (player.spent + amount > SEASON_MAX_SPENDABLE_TOKENS)
        return { feasible: false, reason: 'season-token-limit' }
      const spent = spendStamina({ state: player.state, settings, amount, at })
      if (spent.spent !== amount)
        return { feasible: false, reason: 'insufficient-tokens' }
      player.state = spent.state
      player.at = at
      player.spent += amount
    }
  }
  return { feasible: true }
}
