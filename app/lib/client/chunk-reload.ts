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

// Parse failures from stale/corrupted chunks served as HTML after a deploy.
// Conservative patterns to avoid false positives from extension-injected scripts.
const CHUNK_PARSE_ERROR_MESSAGE_PATTERNS: RegExp[] = [
  /^Unexpected token/u,
  /^Unexpected end of input/u,
  /^Invalid or unexpected token/u,
  /^Unexpected reserved word/u,
  /^Unexpected number/u,
  /^Unexpected string/u,
  /^Unexpected identifier/u
]

const RUNTIME_JSON_PARSE_MESSAGE_PATTERN =
  /is not valid JSON|\bin JSON\b|^JSON\.parse:|^JSON Parse error:|JSON input/iu

const EXTENSION_FRAME_PATTERN =
  /(?:chrome|moz|safari(?:-web)?)-extension:|app:\/\/\/|(?:^|\/)inpage\.js\b/iu

export interface ChunkErrorContext {
  resourceFilename?: string
}

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

function stripLocationLineCol(raw: string): {
  resource: string
  suffixCount: number
} {
  let resource = raw
  let suffixCount = 0

  while (suffixCount < 3) {
    const colonIndex = resource.lastIndexOf(':')
    if (colonIndex <= 0) break
    const tail = resource.slice(colonIndex + 1)
    if (!/^\d+$/u.test(tail)) break
    resource = resource.slice(0, colonIndex)
    suffixCount += 1
  }

  return { resource, suffixCount }
}

function isNextScriptResourceLocation(
  raw: string,
  options: { requireLineSuffix: boolean; allowNodeNextRuntime: boolean }
): boolean {
  const trimmed = raw.trim()
  if (
    trimmed.length === 0 ||
    /[\s()<>@]/u.test(trimmed) ||
    EXTENSION_FRAME_PATTERN.test(trimmed)
  ) {
    return false
  }

  const { resource, suffixCount } = stripLocationLineCol(trimmed)
  if (options.requireLineSuffix) {
    if (suffixCount === 0 || suffixCount > 2) return false
  } else if (suffixCount !== 0) {
    return false
  }

  const withoutQuery = resource.split('#')[0]?.split('?')[0] ?? ''
  if (!/\.m?js$/iu.test(withoutQuery)) {
    return false
  }

  if (
    withoutQuery.startsWith('http://') ||
    withoutQuery.startsWith('https://')
  ) {
    try {
      return new URL(withoutQuery).pathname.startsWith('/_next/static/')
    } catch {
      return false
    }
  }

  if (
    withoutQuery.startsWith('/_next/static/') ||
    withoutQuery.startsWith('_next/static/')
  ) {
    return true
  }

  if (!options.allowNodeNextRuntime) {
    return false
  }

  const normalized = withoutQuery.replaceAll('\\', '/')
  return (
    normalized.startsWith('node_modules/next/') ||
    normalized.includes('/node_modules/next/')
  )
}

function extractAnonymousFrameLocation(frameLine: string): string | null {
  if (frameLine.startsWith('at ')) {
    const target = frameLine
      .slice(3)
      .trim()
      .replace(/^async\s+/u, '')
    if (target.includes('(') || target.includes(')') || target.includes(' ')) {
      return null
    }
    return target
  }

  for (const prefix of ['@', 'global code@', 'module code@'] as const) {
    if (frameLine.startsWith(prefix)) {
      return frameLine.slice(prefix.length)
    }
  }

  return null
}

// Require top-level script-resource parse evidence so runtime JSON.parse/eval
// SyntaxErrors thrown from inside already-loaded Next chunks never trigger reload.
function hasChunkScriptParseEvidence(
  value: unknown,
  resourceFilename?: string
): boolean {
  if (!(value instanceof Error) || typeof value.stack !== 'string') {
    return false
  }

  const rawLines = value.stack.split(/\r?\n/u)
  const headerIndex = rawLines.findIndex((line) =>
    line.trimStart().startsWith('SyntaxError')
  )
  const preludeLines =
    headerIndex > 0
      ? rawLines
          .slice(0, headerIndex)
          .map((line) => line.trim())
          .filter(Boolean)
      : []
  const frameLines = (
    headerIndex >= 0 ? rawLines.slice(headerIndex + 1) : rawLines
  )
    .map((line) => line.trim())
    .filter(Boolean)

  if (frameLines.some((line) => EXTENSION_FRAME_PATTERN.test(line))) {
    return false
  }

  if (preludeLines.length > 0) {
    const firstFrame = frameLines[0] ?? ''
    return (
      isNextScriptResourceLocation(preludeLines[0], {
        requireLineSuffix: true,
        allowNodeNextRuntime: true
      }) &&
      (firstFrame.startsWith('at new Script (') ||
        firstFrame.startsWith('at compileFunction (')) &&
      !frameLines.some((line) => line.includes('_next/'))
    )
  }

  if (frameLines.length === 1) {
    const location = extractAnonymousFrameLocation(frameLines[0])
    return (
      location !== null &&
      isNextScriptResourceLocation(location, {
        requireLineSuffix: true,
        allowNodeNextRuntime: true
      })
    )
  }

  if (frameLines.length === 0 && typeof resourceFilename === 'string') {
    return isNextScriptResourceLocation(resourceFilename, {
      requireLineSuffix: false,
      allowNodeNextRuntime: false
    })
  }

  return false
}

export function isChunkLoadError(
  value: unknown,
  context?: ChunkErrorContext
): boolean {
  const errorLike = toErrorLike(value)
  if (!errorLike) return false
  if (errorLike.name === CHUNK_LOAD_ERROR_NAME) return true
  const message = errorLike.message ?? ''
  if (
    CHUNK_LOAD_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return true
  }
  return (
    errorLike.name === 'SyntaxError' &&
    !RUNTIME_JSON_PARSE_MESSAGE_PATTERN.test(message) &&
    CHUNK_PARSE_ERROR_MESSAGE_PATTERNS.some((pattern) =>
      pattern.test(message)
    ) &&
    hasChunkScriptParseEvidence(value, context?.resourceFilename)
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
export function resolveChunkReloadOutcome(
  value: unknown,
  context?: ChunkErrorContext
): ChunkReloadOutcome {
  if (!isChunkLoadError(value, context)) {
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

export function handleChunkLoadError(
  value: unknown,
  context?: ChunkErrorContext
): ChunkReloadOutcome {
  const outcome = resolveChunkReloadOutcome(value, context)
  if (outcome === 'attempted' || outcome === 'suppressed') {
    captureSentryException(value, { tags: { chunk_reload: outcome } })
  }
  return outcome
}

function handleWindowError(event: ErrorEvent): void {
  handleChunkLoadError(event.error ?? event.message, {
    resourceFilename:
      typeof event.filename === 'string' ? event.filename : undefined
  })
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
