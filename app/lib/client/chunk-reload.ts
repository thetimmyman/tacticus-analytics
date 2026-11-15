/**
 * A tab open across a deploy 404s on the previous build's chunks; reload at most
 * once per session per build, so a broken deploy cannot loop.
 */

import { captureSentryException } from '@/app/lib/monitoring/sentry'

const SESSION_KEY_PREFIX = 'tacticus_chunk_reload_'

const CHUNK_LOAD_ERROR_NAME = 'ChunkLoadError'

const CHUNK_LOAD_ERROR_MESSAGE_PATTERNS: RegExp[] = [
  /Loading chunk [\w-]+ failed/i,
  /Failed to load chunk\b/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i
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

function readStringProperty(
  record: Record<string, unknown>,
  key: 'name' | 'message'
): string | undefined {
  try {
    const value = record[key]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function toErrorLike(value: unknown): ErrorLike | null {
  if (typeof value === 'string') {
    return { message: value }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const name = readStringProperty(record, 'name')
    const message = readStringProperty(record, 'message')
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

  const preludeLine = preludeLines[0]
  if (preludeLine !== undefined) {
    const firstFrame = frameLines[0] ?? ''
    return (
      isNextScriptResourceLocation(preludeLine, {
        requireLineSuffix: true,
        allowNodeNextRuntime: true
      }) &&
      (firstFrame.startsWith('at new Script (') ||
        firstFrame.startsWith('at compileFunction (')) &&
      !frameLines.some((line) => line.includes('_next/'))
    )
  }

  const singleFrame = frameLines[0]
  if (frameLines.length === 1 && singleFrame !== undefined) {
    const location = extractAnonymousFrameLocation(singleFrame)
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

function matchesSingleChunkLoadError(
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

export function isChunkLoadError(
  value: unknown,
  context?: ChunkErrorContext
): boolean {
  try {
    if (matchesSingleChunkLoadError(value, context)) {
      return true
    }
    if (value instanceof Error && value.cause !== undefined) {
      return matchesSingleChunkLoadError(value.cause, context)
    }
  } catch {
    return false
  }
  return false
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

type ResolvedChunkOutcome = 'attempted' | 'suppressed'

interface ChunkOccurrenceRecord {
  outcome: ResolvedChunkOutcome
  taggedTag?: ResolvedChunkOutcome
  handlerBound: boolean
  globalBound: boolean
  taggedBound: boolean
  taggedProcessed: boolean
  globalProcessed: boolean
}

const MAX_STRING_TRACKING_ENTRIES = 64
const MAX_OCCURRENCES_PER_KEY = 64

const objectChunkOccurrences = new WeakMap<object, ChunkOccurrenceRecord[]>()
const stringChunkOccurrences = new Map<string, ChunkOccurrenceRecord[]>()

function evictOldestMapEntry<K, V>(map: Map<K, V>, maxEntries: number): void {
  if (map.size < maxEntries) return
  const oldestKey = map.keys().next().value
  if (oldestKey !== undefined) {
    map.delete(oldestKey)
  }
}

function getExistingOccurrenceQueue(
  value: unknown
): ChunkOccurrenceRecord[] | undefined {
  if (value && typeof value === 'object') {
    return objectChunkOccurrences.get(value)
  }
  if (typeof value === 'string') {
    return stringChunkOccurrences.get(value)
  }
  return undefined
}

function getOrCreateOccurrenceQueue(
  value: unknown
): ChunkOccurrenceRecord[] | null {
  if (value && typeof value === 'object') {
    let queue = objectChunkOccurrences.get(value)
    if (!queue) {
      queue = []
      objectChunkOccurrences.set(value, queue)
    }
    return queue
  }
  if (typeof value === 'string') {
    let queue = stringChunkOccurrences.get(value)
    if (!queue) {
      evictOldestMapEntry(stringChunkOccurrences, MAX_STRING_TRACKING_ENTRIES)
      queue = []
      stringChunkOccurrences.set(value, queue)
    }
    return queue
  }
  return null
}

function pushBoundedOccurrence(
  queue: ChunkOccurrenceRecord[],
  record: ChunkOccurrenceRecord
): void {
  if (queue.length >= MAX_OCCURRENCES_PER_KEY) {
    queue.shift()
  }
  queue.push(record)
}

function removeOccurrenceFromQueue(
  value: unknown,
  record: ChunkOccurrenceRecord
): void {
  const queue = getExistingOccurrenceQueue(value)
  if (!queue) return
  const index = queue.indexOf(record)
  if (index !== -1) {
    queue.splice(index, 1)
  }
  if (queue.length === 0 && typeof value === 'string') {
    stringChunkOccurrences.delete(value)
  }
}

function readFallbackSessionOutcome(): ResolvedChunkOutcome {
  const storage = getSessionStorage()
  if (!storage) {
    return 'suppressed'
  }
  try {
    return storage.getItem(sessionKey(resolveBuildId())) === '1'
      ? 'suppressed'
      : 'attempted'
  } catch {
    return 'suppressed'
  }
}

function registerHandlerChunkOccurrence(
  value: unknown,
  outcome: ResolvedChunkOutcome
): ChunkOccurrenceRecord | null {
  const queue = getOrCreateOccurrenceQueue(value)
  if (!queue) return null

  const unmatchedGlobal = queue.find(
    (entry) => entry.globalBound && !entry.handlerBound
  )
  if (unmatchedGlobal) {
    unmatchedGlobal.handlerBound = true
    unmatchedGlobal.taggedTag = outcome
    return unmatchedGlobal
  }

  const record: ChunkOccurrenceRecord = {
    outcome,
    taggedTag: outcome,
    handlerBound: true,
    globalBound: false,
    taggedBound: false,
    taggedProcessed: false,
    globalProcessed: false
  }
  pushBoundedOccurrence(queue, record)
  return record
}

/**
 * Correlate a single tagged or global-handler chunk capture per occurrence so
 * concurrent same-text or shared-reference failures preserve each occurrence's
 * attempted/suppressed outcome without dropping warnings.
 */
export function resolveChunkTelemetryEvent(
  value: unknown,
  options: { existingTag?: string; isGlobalHandler: boolean }
): 'duplicate' | ResolvedChunkOutcome | undefined {
  const { existingTag, isGlobalHandler } = options

  if (existingTag === 'attempted' || existingTag === 'suppressed') {
    const queue = getExistingOccurrenceQueue(value)
    const matched =
      queue?.find(
        (entry) =>
          !entry.taggedBound &&
          (entry.taggedTag === existingTag ||
            (!entry.handlerBound && entry.outcome === existingTag))
      ) ?? queue?.find((entry) => !entry.taggedBound && !entry.handlerBound)

    if (matched) {
      matched.taggedBound = true
      if (matched.globalProcessed) {
        matched.taggedProcessed = true
        removeOccurrenceFromQueue(value, matched)
        return 'duplicate'
      }
      matched.taggedProcessed = true
      if (matched.globalBound) {
        removeOccurrenceFromQueue(value, matched)
      }
      return existingTag
    }

    const createdQueue = getOrCreateOccurrenceQueue(value)
    if (createdQueue) {
      pushBoundedOccurrence(createdQueue, {
        outcome: existingTag,
        taggedTag: existingTag,
        handlerBound: true,
        globalBound: false,
        taggedBound: true,
        taggedProcessed: true,
        globalProcessed: false
      })
    }
    return existingTag
  }

  if (existingTag === undefined && isGlobalHandler) {
    const queue = getExistingOccurrenceQueue(value)
    const matched = queue?.find((entry) => !entry.globalBound)
    if (matched) {
      matched.globalBound = true
      if (matched.taggedProcessed) {
        matched.globalProcessed = true
        removeOccurrenceFromQueue(value, matched)
        return 'duplicate'
      }
      if (value instanceof Error) {
        removeOccurrenceFromQueue(value, matched)
      } else {
        matched.globalProcessed = true
      }
      return matched.outcome
    }

    const fallbackOutcome = readFallbackSessionOutcome()
    if (!(value instanceof Error)) {
      const createdQueue = getOrCreateOccurrenceQueue(value)
      if (createdQueue) {
        pushBoundedOccurrence(createdQueue, {
          outcome: fallbackOutcome,
          handlerBound: false,
          globalBound: true,
          taggedBound: false,
          taggedProcessed: false,
          globalProcessed: true
        })
      }
    }
    return fallbackOutcome
  }

  return undefined
}

/** Record a chunk event only after Sentry beforeSend actually processes it. */
export function recordProcessedChunkEvent(
  value: unknown,
  source: 'tagged' | 'global'
): void {
  if (source === 'tagged') {
    const queue = getOrCreateOccurrenceQueue(value)
    if (!queue) return
    const pending = queue.find((entry) => !entry.taggedProcessed)
    if (pending) {
      pending.taggedBound = true
      pending.taggedProcessed = true
      if (pending.globalBound) {
        removeOccurrenceFromQueue(value, pending)
      }
      return
    }
    const outcome = readFallbackSessionOutcome()
    pushBoundedOccurrence(queue, {
      outcome,
      taggedTag: outcome,
      handlerBound: true,
      globalBound: false,
      taggedBound: true,
      taggedProcessed: true,
      globalProcessed: false
    })
    return
  }

  if (value instanceof Error) return
  const queue = getOrCreateOccurrenceQueue(value)
  if (!queue) return
  const pending = queue.find((entry) => !entry.globalProcessed)
  if (pending) {
    pending.globalBound = true
    pending.globalProcessed = true
    if (pending.taggedProcessed) {
      removeOccurrenceFromQueue(value, pending)
    }
    return
  }
  pushBoundedOccurrence(queue, {
    outcome: readFallbackSessionOutcome(),
    handlerBound: false,
    globalBound: true,
    taggedBound: false,
    taggedProcessed: false,
    globalProcessed: true
  })
}

/** True only when a matching chunk event already cleared Sentry beforeSend. */
export function consumeCapturedChunkReloadDuplicate(
  value: unknown,
  source: 'tagged' | 'global' = 'tagged'
): boolean {
  const queue = getExistingOccurrenceQueue(value)
  if (!queue || queue.length === 0) return false

  if (source === 'tagged') {
    const matched = queue.find(
      (entry) => entry.taggedProcessed && !entry.globalBound
    )
    if (!matched) return false
    matched.globalBound = true
    matched.globalProcessed = true
    removeOccurrenceFromQueue(value, matched)
    return true
  }

  if (value instanceof Error) return false
  const matched = queue.find(
    (entry) => entry.globalProcessed && !entry.taggedBound
  )
  if (!matched) return false
  matched.taggedBound = true
  matched.taggedProcessed = true
  removeOccurrenceFromQueue(value, matched)
  return true
}

/** Read-only outcome for chunk failures seen via global handlers, even if async beforeSend runs after sessionStorage mutation. */
export function peekChunkReloadOutcome(
  value?: unknown
): 'attempted' | 'suppressed' {
  const queue = getExistingOccurrenceQueue(value)
  const pending = queue?.find((entry) => !entry.globalBound)
  if (pending) {
    return pending.outcome
  }
  return readFallbackSessionOutcome()
}

export function handleChunkLoadError(
  value: unknown,
  context?: ChunkErrorContext
): ChunkReloadOutcome {
  const outcome = resolveChunkReloadOutcome(value, context)
  if (outcome === 'attempted' || outcome === 'suppressed') {
    const registered = registerHandlerChunkOccurrence(value, outcome)
    const captured = captureSentryException(value, {
      tags: { chunk_reload: outcome }
    })
    if (captured === false && registered) {
      removeOccurrenceFromQueue(value, registered)
    }
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
