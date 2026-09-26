/** Runs once at server start: undici fetch patching, Sentry, background workers. */

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Patch fetch before any other import: Next's shared undici pool degrades in long-running containers.
    try {
      const { patchGlobalFetch } =
        await import('./app/lib/network/undici-agent')
      const patched = patchGlobalFetch()
      if (patched) {
        console.log(
          '[instrumentation] globalThis.fetch patched with fresh undici Agent'
        )
      } else {
        console.warn(
          '[instrumentation] Failed to patch globalThis.fetch — undici unavailable'
        )
      }
    } catch (error) {
      console.warn('[instrumentation] Error patching globalThis.fetch:', error)
    }

    await import('./sentry.server.config')

    // Ban-repair verify worker in every production server process; work_queue's
    // atomic claim keeps pods safe and a local guard prevents overlapping ticks.
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.NEXT_PHASE !== 'phase-production-build'
    ) {
      const { startVerifyWorkerScheduler } =
        await import('./app/lib/jobs/verify-worker-scheduler')
      startVerifyWorkerScheduler()
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
