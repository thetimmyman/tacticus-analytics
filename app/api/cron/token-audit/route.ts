import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { cronGuard } from '@/app/lib/scheduler/cron-guard'
import { runTokenAudit } from '@/app/lib/token-audit/run-token-audit'
import { AUDIT_MODES, type AuditMode } from '@/app/lib/token-audit/audit-core'

const logger = createComponentLogger('api.cron.token-audit')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Hourly, but per guild daily outside the rollover window. 202 { held: true } until the table exists. */
export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    requireCronSecret(request)

    const guard = await cronGuard()
    if (!guard.shouldExecute) {
      return NextResponse.json({ skipped: true, reason: guard.reason })
    }

    const modeParam = request.nextUrl.searchParams.get('mode')
    let forceMode: AuditMode | null = null
    if (modeParam) {
      if (!(AUDIT_MODES as readonly string[]).includes(modeParam)) {
        throw Errors.fromResponse(400, {
          error: `Invalid mode '${modeParam}'; expected one of: ${AUDIT_MODES.join(', ')}`
        })
      }
      forceMode = modeParam as AuditMode
    }

    const summary = await runTokenAudit({ forceMode })

    if (summary.held) {
      return NextResponse.json(
        {
          success: true,
          held: true,
          reason: 'token_audit_snapshots not deployed yet'
        },
        { status: 202 }
      )
    }

    return NextResponse.json({
      success: true,
      ...summary,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[Token Audit] Cron job error')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
