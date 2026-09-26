export type UnknownRecord = Record<string, unknown>
export type ValuePath = ReadonlyArray<string | number>

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null

export const toRecord = (value: unknown): UnknownRecord | null =>
  isRecord(value) ? value : null

export const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : fallback
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export const toStringSafe = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback

export const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry)) : []

export const getNestedValue = (source: unknown, path: ValuePath): unknown => {
  let current = source
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
      continue
    }
    const record = toRecord(current)
    if (!record || !(segment in record)) return undefined
    current = record[segment]
  }
  return current
}

export const getFirstStringValue = (
  source: unknown,
  paths: readonly ValuePath[]
): string | null => {
  for (const path of paths) {
    const value = getNestedValue(source, path)
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

export const getFirstBooleanValue = (
  source: unknown,
  paths: readonly ValuePath[]
): boolean | null => {
  for (const path of paths) {
    const value = getNestedValue(source, path)
    if (typeof value === 'boolean') return value
  }
  return null
}

export const getRecordsArrayFromPaths = (
  source: unknown,
  paths: readonly ValuePath[]
): UnknownRecord[] => {
  for (const path of paths) {
    const value = getNestedValue(source, path)
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

export const getFirstStringArray = (
  source: unknown,
  paths: readonly ValuePath[]
): string[] => {
  for (const path of paths) {
    const value = getNestedValue(source, path)
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string')
    }
  }
  return []
}

export const getStringFromRecord = (
  record: UnknownRecord | null | undefined,
  key: string
): string | null => {
  const value = record?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}

export const getNumberFromRecord = (
  record: UnknownRecord | null | undefined,
  key: string
): number | null => {
  const value = record?.[key]
  return typeof value === 'number' ? value : null
}
