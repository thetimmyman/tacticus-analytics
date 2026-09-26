const DEFAULT_ENTROPY = 8

/** `Date.now()` plus `entropy` base-36 chars (clamped to [1, 13]). */
export function generateId(
  prefix?: string,
  entropy: number = DEFAULT_ENTROPY
): string {
  const safeEntropy = Math.max(1, Math.min(13, Math.floor(entropy)))
  const random = Math.random()
    .toString(36)
    .slice(2, 2 + safeEntropy)
  const stamp = Date.now()
  return prefix ? `${prefix}-${stamp}-${random}` : `${stamp}-${random}`
}

/** Only when an external contract requires a UUID v4; otherwise prefer generateId(). */
export function generateUUID(): string {
  if (
    typeof crypto === 'undefined' ||
    typeof crypto.randomUUID !== 'function'
  ) {
    throw new Error('crypto.randomUUID() is not available in this runtime')
  }
  return crypto.randomUUID()
}
