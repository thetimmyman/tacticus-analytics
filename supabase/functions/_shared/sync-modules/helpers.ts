export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const toStringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

export const toNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

export const serializeDetails = (details: unknown): string | null => {
  if (details === null || details === undefined) return null
  if (typeof details === 'string') return details
  try {
    return JSON.stringify(details)
  } catch {
    return null
  }
}

export const processTimestamp = (timestamp: unknown): string => {
  if (timestamp === null || timestamp === undefined)
    return new Date().toISOString()
  const numeric = toNumberValue(timestamp)
  if (numeric === null) return new Date().toISOString()
  const epochMs = numeric < 10000000000 ? numeric * 1000 : numeric
  return new Date(epochMs).toISOString()
}

// Both raid writers (this and app/lib/sync/transformers.ts) must truncate to
// whole seconds, or EOT_GR_data's unique_battle_record_complete misses dupes.
export const truncateIsoToWholeSecond = (
  iso: string | null | undefined
): string | null => {
  if (!iso) return null
  return iso.replace(/\.\d+Z$/, '.000Z')
}

export const processSetValue = (setValue: unknown): number => {
  const numeric = toNumberValue(setValue)
  if (numeric === null) return 0
  const setNum = Math.trunc(numeric)
  if (isNaN(setNum) || setNum < 0) return 0
  if (setNum > 4) return 4
  return setNum
}
