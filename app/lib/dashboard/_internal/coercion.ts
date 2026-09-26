export const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  return toNumber(value)
}

export const toPositiveNumberOrNull = (value: unknown): number | null => {
  const parsed = toNullableNumber(value)
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export const toNonNegativeNumberOrNull = (value: unknown): number | null => {
  const parsed = toNullableNumber(value)
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export const readNumericProp = (
  source: Record<string, unknown>,
  keys: string[]
): number | null => {
  for (const key of keys) {
    const value = source[key]
    if (value === null || value === undefined) {
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) {
        return parsed
      }
    }
  }
  return null
}

export const readStringProp = (
  source: Record<string, unknown>,
  keys: string[]
): string | null => {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }
  return null
}

export const normalizeName = (value?: string | null): string | null =>
  value?.trim().toLowerCase() ?? null

export const parseTimestampSafe = (value?: string | null): number | null => {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}
