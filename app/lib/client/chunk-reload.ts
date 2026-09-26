/**
 * A tab open across a deploy 404s on the previous build's chunks; reload at most
 * once per session per build, so a broken deploy cannot loop.
 */

import { captureSentryException } from '@/app/lib/monitoring/sentry'

const SESSION_KEY_PREFIX = 'tacticus_chunk_reload_'

const CHUNK_LOAD_ERROR_NAME = 'ChunkLoadError'

const CHUNK_LOAD_ERROR_MESSAGE_PATTERNS: RegExp[] = [
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i
]

export type ChunkReloadOutcome = 'attempted' | 'suppressed' | 'ignored'

interface ErrorLike {
  name?: string
  message?: string
}

function toErrorLike(value: unknown): ErrorLike | null {
  if (value instanceof Error) {
    return { name: value.name, message: value.message }
  }
  if (typeof value === 'string') {
    return { message: value }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : undefined
    const message =
      typeof record.message === 'string' ? record.message : undefined
    if (name === undefined && message === undefined) {
      return null
    }
    return { name, message }
  }
  return null
}

export function isChunkLoadError(value: unknown): boolean {
  const errorLike = toErrorLike(value)
  if (!errorLike) return false
  if (errorLike.name === CHUNK_LOAD_ERROR_NAME) return true
  const message = errorLike.message ?? ''
  return CHUNK_LOAD_ERROR_MESSAGE_PATTERNS.some((pattern) =>
    pattern.test(message)
  )
}

/** Without NEXT_PUBLIC_BUILD_SHA the guard cannot tell builds apart. */
export function resolveBuildId(): string {
  return process.env.NEXT_PUBLIC_BUILD_SHA || 'unknown-build'
}

function sessionKey(buildId: string): string {
  return `${SESSION_KEY_PREFIX}${buildId}`
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return null
    }
    return window.sessionStorage
  } catch {
    // Privacy mode can make sessionStorage throw on access.
    return null
  }
}

/** 'suppressed' = already tried this build/session or storage unusable: show normal error UI. */
export function resolveChunkReloadOutcome(value: unknown): ChunkReloadOutcome {
  if (!isChunkLoadError(value)) {
    return 'ignored'
  }

  const storage = getSessionStorage()
  if (!storage) {
    return 'suppressed'
  }

  const key = sessionKey(resolveBuildId())

  // Storage can throw; escaping would replace the error boundary's fallback, and an
  // unpersisted guard could loop, so suppress.
  let alreadyAttempted: boolean
  try {
    alreadyAttempted = storage.getItem(key) === '1'
  } catch {
    return 'suppressed'
  }

  if (alreadyAttempted) {
    return 'suppressed'
  }

  try {
    storage.setItem(key, '1')
  } catch {
    return 'suppressed'
  }

  window.location.reload()
  return 'attempted'
}

export function handleChunkLoadError(value: unknown): ChunkReloadOutcome {
  const outcome = resolveChunkReloadOutcome(value)
  if (outcome === 'attempted' || outcome === 'suppressed') {
    captureSentryException(value, { tags: { chunk_reload: outcome } })
  }
  return outcome
}

function handleWindowError(event: ErrorEvent): void {
  handleChunkLoadError(event.error ?? event.message)
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  handleChunkLoadError(event.reason)
}

let listenersInstalled = false

/** Idempotent (Fast Refresh may re-run it). */
export function initChunkReloadListeners(): () => void {
  if (typeof window === 'undefined' || listenersInstalled) {
    return () => {}
  }

  listenersInstalled = true
  window.addEventListener('error', handleWindowError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)

  return () => {
    window.removeEventListener('error', handleWindowError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    listenersInstalled = false
  }
}
