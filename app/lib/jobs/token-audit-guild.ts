// One job per guild so each fits a tick and retries alone; priority 7 yields to realtime batch jobs.

import { createComponentLogger } from '@/app/lib/logging'
import { runTokenAuditForGuild } from '@/app/lib/token-audit/run-token-audit'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'

const logger = createComponentLogger('lib.jobs.token-audit-guild')

const tokenAuditGuildHandler: JobHandler = async (payload, ctx) => {
  const guildCode = payload.guild_code
  if (typeof guildCode !== 'string' || !guildCode.trim()) {
    throw new Error(
      `token-audit-guild: missing/invalid guild_code in payload: ${JSON.stringify(payload)}`
    )
  }

  const summary = await runTokenAuditForGuild({ guildCode: guildCode.trim() })

  logger.info(
    {
      jobId: ctx.jobId,
      guildCode: summary.guild_code,
      season: summary.season,
      held: summary.held,
      skipped: summary.skipped,
      reason: summary.reason,
      rowsInserted: summary.result?.rows_inserted ?? 0
    },
    'token-audit-guild job complete'
  )

  return {
    held: summary.held,
    season: summary.season,
    guild_code: summary.guild_code,
    skipped: summary.skipped,
    reason: summary.reason,
    ...(summary.result ?? {})
  }
}

export function registerTokenAuditGuildHandler(): void {
  registerJobHandler('token-audit-guild', tokenAuditGuildHandler)
}

export const __internal = {
  tokenAuditGuildHandler
}
