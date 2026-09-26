export const MIN_OBFUSCATION_PERCENT = 1
export const MAX_OBFUSCATION_PERCENT = 30
export const DEFAULT_OBFUSCATION_PERCENT = 10

export function normalizeObfuscationPercent(value?: number | null): number {
  if (value === null || value === undefined) {
    return DEFAULT_OBFUSCATION_PERCENT
  }

  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_OBFUSCATION_PERCENT
  }

  const clamped = Math.min(
    MAX_OBFUSCATION_PERCENT,
    Math.max(MIN_OBFUSCATION_PERCENT, Math.round(numericValue))
  )
  return clamped
}
