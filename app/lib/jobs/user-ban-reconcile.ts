import { serviceDb } from '@/app/lib/db'
import {
  enqueueUserBanReconciliation,
  parseUserBanReconciliationPayload,
  reconcileUserBanState,
  USER_BAN_RECONCILIATION_JOB_TYPE
} from '@/app/lib/auth/user-ban-reconciliation'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'

const FALLBACK_DEADLINE_MS = 45_000

function operationSignal(
  deadlineController: AbortController,
  parentSignal?: AbortSignal
): AbortSignal {
  return parentSignal
    ? AbortSignal.any([parentSignal, deadlineController.signal])
    : deadlineController.signal
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

function payloadForUser(
  payload: ReturnType<typeof parseUserBanReconciliationPayload>,
  userId: string
) {
  return {
    lockUserIds: [userId],
    adminCandidateUserIds: payload.adminCandidateUserIds.includes(userId)
      ? [userId]
      : [],
    credentialUserIds: payload.credentialUserIds.includes(userId)
      ? [userId]
      : []
  }
}

const userBanReconcileHandler: JobHandler = async (payload, context) => {
  const lockSupabase = serviceDb()
  const parsed = parseUserBanReconciliationPayload(payload)
  const deadlineAt = context.softDeadlineAt ?? Date.now() + FALLBACK_DEADLINE_MS

  // Legacy multi-user job: complete it only once the per-user jobs are durable;
  // active-dedupe conflicts make a retried split idempotent.
  if (parsed.lockUserIds.length > 1) {
    const splitBudgetMs = deadlineAt - Date.now()
    if (splitBudgetMs <= 0) {
      throw new Error('Ban reconciliation deferred at the worker deadline')
    }
    const controller = new AbortController()
    const signal = operationSignal(controller, context.signal)
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error('split legacy ban reconciliation job timed out')
        ),
      splitBudgetMs
    )
    timer.unref?.()
    try {
      throwIfAborted(signal)
      // Await the signal-bound call; a promise-only timeout would leave the enqueue request alive.
      await enqueueUserBanReconciliation(serviceDb(signal), parsed)
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
    return { status: 'split', jobsEnqueued: parsed.lockUserIds.length }
  }

  const userId = parsed.lockUserIds[0]
  if (!userId) throw new Error('Ban reconciliation job has no user')
  const remainingMs = deadlineAt - Date.now()
  if (remainingMs <= 0) {
    throw new Error('Ban reconciliation deferred at the worker deadline')
  }

  const controller = new AbortController()
  const signal = operationSignal(controller, context.signal)
  const timer = setTimeout(
    () => controller.abort(new Error('ban reconciliation user step timed out')),
    remainingMs
  )
  timer.unref?.()
  let result
  try {
    throwIfAborted(signal)
    // Stay pending through lock release after cancellation so the scheduler cannot overlap this tick.
    result = await reconcileUserBanState(
      lockSupabase,
      payloadForUser(parsed, userId),
      {
        operationSupabase: serviceDb(signal),
        signal
      }
    )
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
  return { status: 'reconciled', ...result }
}

export function registerUserBanReconcileHandler(): void {
  registerJobHandler(USER_BAN_RECONCILIATION_JOB_TYPE, userBanReconcileHandler)
}

export const __internal = { userBanReconcileHandler }
