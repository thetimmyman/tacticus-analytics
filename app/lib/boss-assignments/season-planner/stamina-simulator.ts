export type UnixMillis = number

export interface StaminaSettings {
  max: number
  regenerationSeconds: number
  amountPerTick: number
}

export interface StaminaState {
  available: number
  nextRegenAt: UnixMillis | null
}

export interface StaminaAdvanceMetrics {
  regenTicks: number
  cappedSeconds: number
  wastedTicks: number
  wastedTokens: number
}

export interface AdvanceStaminaArgs {
  state: StaminaState
  settings: StaminaSettings
  from: UnixMillis
  to: UnixMillis
}

export interface AdvanceStaminaResult {
  state: StaminaState
  metrics: StaminaAdvanceMetrics
}

export interface SpendStaminaArgs {
  state: StaminaState
  settings: StaminaSettings
  amount: number
  at: UnixMillis
}

export interface SpendStaminaResult {
  state: StaminaState
  spent: number
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const rounded = Math.floor(value)
  return Math.min(max, Math.max(min, rounded))
}

function ensurePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const rounded = Math.floor(value)
  return rounded > 0 ? rounded : fallback
}

function regenMillis(settings: StaminaSettings): number {
  return ensurePositiveInt(settings.regenerationSeconds, 1) * 1000
}

export function normaliseStaminaState(
  state: StaminaState,
  settings: StaminaSettings,
  at: UnixMillis
): StaminaState {
  const max = ensurePositiveInt(settings.max, 1)
  const available = clampInt(state.available, 0, max)

  if (available >= max) {
    return { available: max, nextRegenAt: null }
  }

  const nextRegenAt = state.nextRegenAt ?? at + regenMillis(settings)

  return {
    available,
    nextRegenAt: nextRegenAt < at ? at : nextRegenAt
  }
}

export function spendStamina({
  state,
  settings,
  amount,
  at
}: SpendStaminaArgs): SpendStaminaResult {
  const max = ensurePositiveInt(settings.max, 1)
  const regenMs = regenMillis(settings)
  const normalised = normaliseStaminaState(state, settings, at)

  const spendAmount = clampInt(amount, 0, max)
  const spent = Math.min(spendAmount, normalised.available)
  const wasCapped =
    normalised.available >= max && normalised.nextRegenAt === null

  const available = normalised.available - spent
  const nextRegenAt =
    spent > 0 && wasCapped && available < max
      ? at + regenMs
      : normalised.nextRegenAt

  return {
    state: {
      available,
      nextRegenAt
    },
    spent
  }
}

export function advanceStamina({
  state,
  settings,
  from,
  to
}: AdvanceStaminaArgs): AdvanceStaminaResult {
  if (to < from) {
    throw new Error('advanceStamina: to must be >= from')
  }

  const max = ensurePositiveInt(settings.max, 1)
  const tickAmount = ensurePositiveInt(settings.amountPerTick, 1)
  const regenMs = regenMillis(settings)

  let time = from
  let { available, nextRegenAt } = normaliseStaminaState(state, settings, from)

  let regenTicks = 0

  while (nextRegenAt !== null && nextRegenAt <= to) {
    time = nextRegenAt

    regenTicks += 1
    available = Math.min(max, available + tickAmount)

    if (available >= max) {
      nextRegenAt = null
      break
    }

    nextRegenAt = nextRegenAt + regenMs
  }

  let cappedSeconds = 0
  let wastedTicks = 0
  let wastedTokens = 0

  if (available >= max) {
    const capDurationMs = Math.max(0, to - time)
    cappedSeconds = capDurationMs / 1000
    wastedTicks = regenMs > 0 ? Math.floor(capDurationMs / regenMs) : 0
    wastedTokens = wastedTicks * tickAmount
  }

  return {
    state: {
      available,
      nextRegenAt
    },
    metrics: {
      regenTicks,
      cappedSeconds,
      wastedTicks,
      wastedTokens
    }
  }
}
