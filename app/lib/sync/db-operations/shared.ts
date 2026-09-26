// Shared by the db-operations siblings (internal-only; not re-exported by the barrel).

import { createComponentLogger } from '@/app/lib/logging'
export const logger = createComponentLogger('lib.sync.db-operations')
import { parseSupabaseError } from '@/app/lib/utils/error-handling'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

export type StrictSupabaseClient = TypedSupabaseClient

export const BATCH_CONFIG = {
  batchSize: 500,
  batchDelay: 100
} as const

export function getErrorMessage(error: unknown): string {
  const parsed = parseSupabaseError(error)
  return parsed.message
}

export function isRecentTimestamp(
  timestamp: string | null | undefined
): boolean {
  if (!timestamp) {
    return false
  }

  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) {
    return false
  }

  return Date.now() - parsed < 5000
}
