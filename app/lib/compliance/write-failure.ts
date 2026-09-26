/** Never values: postgrest-js `details` can quote user data. */
export type WriteFailure = {
  errorClass: string
  code: string | null
  status: number | null
  fields: string[]
}

const NON_ENUMERABLE_FIELDS = ['message', 'name', 'stack', 'cause'] as const

function readStatus(record: Record<string, unknown>): number | null {
  for (const key of ['status', 'statusCode'] as const) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value)
  }
  return null
}

function readCode(record: Record<string, unknown>): string | null {
  const value = record.code
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number') return String(value)
  return null
}

export function describeWriteFailure(error: unknown): WriteFailure {
  if (error instanceof WriteFailureError) return error.failure

  if (error === null || typeof error !== 'object') {
    return {
      errorClass: error === null ? 'null' : typeof error,
      code: null,
      status: null,
      fields: []
    }
  }

  const record = error as Record<string, unknown>
  const errorClass =
    error instanceof Error
      ? error.name || 'Error'
      : (error.constructor?.name ?? 'Object')

  const names = new Set<string>(Object.keys(record))
  for (const key of NON_ENUMERABLE_FIELDS) {
    if (record[key] !== undefined && record[key] !== null) names.add(key)
  }

  const fields = [...names]
    .filter((name) => {
      const value = record[name]
      if (value === undefined || value === null) return false
      if (typeof value === 'string') return value.length > 0
      return true
    })
    .sort()

  return {
    errorClass,
    code: readCode(record),
    status: readStatus(record),
    fields
  }
}

/** Carries its diagnosis across the re-wrap. */
export class WriteFailureError extends Error {
  readonly failure: WriteFailure

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'WriteFailureError'
    this.failure = describeWriteFailure(cause)
  }
}
