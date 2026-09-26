import type { JobHandlerContext } from './types'

/** Epoch-ms: the earlier of the handler's own budget and the tick's `ctx.softDeadlineAt`. */
export function softDeadlineFor(
  startTime: number,
  handlerSoftTimeoutMs: number,
  ctx: Pick<JobHandlerContext, 'softDeadlineAt'>
): number {
  return Math.min(
    startTime + handlerSoftTimeoutMs,
    ctx.softDeadlineAt ?? Number.POSITIVE_INFINITY
  )
}
