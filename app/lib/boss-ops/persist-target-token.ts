export const TARGET_TOKENS_ENDPOINT = '/api/boss-assignments/target-tokens'

export interface SaveTargetTokenInput {
  bossType: string
  rarity: 'Legendary' | 'Mythic'
  /** 1-based, matching boss_target_tokens.set. The hub must send setNumber + 1. */
  set: number
  encounterId: 0 | 1 | 2
  targetTokens: number
  /** Token-only editors must omit it, or every edit un-skips the prime. */
  skip?: boolean
  /** Omitting it writes the '' legacy row, which a season row shadows (silent no-op). */
  seasonNumber: string
  guildCode?: string
}

export class TargetTokenWriteError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'TargetTokenWriteError'
  }
}

export async function saveTargetToken(
  input: SaveTargetTokenInput
): Promise<void> {
  if (input.encounterId === 0 && input.skip) {
    throw new TargetTokenWriteError(400, 'Main boss targets cannot be skipped')
  }
  if (!Number.isFinite(input.targetTokens) || input.targetTokens <= 0) {
    throw new TargetTokenWriteError(400, 'Target tokens must be greater than 0')
  }

  const url = input.guildCode
    ? `${TARGET_TOKENS_ENDPOINT}?guild_code=${encodeURIComponent(input.guildCode)}`
    : TARGET_TOKENS_ENDPOINT

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boss_name: input.bossType,
      rarity: input.rarity,
      set: input.set,
      encounter_id: input.encounterId,
      target_tokens: input.targetTokens,
      ...(input.skip !== undefined ? { skip: input.skip } : {}),
      season_number: input.seasonNumber
      // `notes` is deliberately not sent: null would clobber it.
    })
  })

  if (!res.ok) {
    throw new TargetTokenWriteError(
      res.status,
      (await serverErrorMessage(res)) ??
        (res.status === 403
          ? 'You must be an officer or leader of this guild to set targets'
          : 'Failed to save target')
    )
  }
}

async function serverErrorMessage(res: Response): Promise<string | null> {
  try {
    const payload = (await res.json()) as Record<string, unknown> | null
    if (!payload || typeof payload !== 'object') return null
    const err = payload.error
    if (typeof err === 'string' && err.trim().length > 0) return err
    if (err && typeof err === 'object') {
      const message = (err as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim().length > 0) {
        return message
      }
    }
    const message = payload.message
    return typeof message === 'string' && message.trim().length > 0
      ? message
      : null
  } catch {
    return null
  }
}
