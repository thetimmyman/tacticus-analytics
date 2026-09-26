import 'server-only'

import { createComponentLogger } from '@/app/lib/logging'

export const logger = createComponentLogger('herald')

export type PostOutcome =
  | {
      outcome: 'posted'
      status: number | null
      postedChannels: number
      failedChannels: number
    }
  | { outcome: 'dedup' }
  | { outcome: 'failed'; reason: string; status: number | null }
  | { outcome: 'skipped'; reason: string }
