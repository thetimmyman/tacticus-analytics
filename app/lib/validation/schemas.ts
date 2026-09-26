// Deliberately loose guild-code check for sync ingestion: external Tacticus codes that the strict
// creation validator (app-core/api-errors) rejects must pass. Do not repoint callers.

export function validateGuildCode(code: unknown): string {
  if (typeof code !== 'string') {
    throw new Error('Guild code must be a string')
  }
  const trimmed = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,10}$/.test(trimmed)) {
    throw new Error('Invalid guild code format')
  }
  return trimmed
}
