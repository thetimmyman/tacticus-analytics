/**
 * Static, nonvisual telemetry tags for browser render failures.
 *
 * Only the first path segment is inspected. Path remainders, queries,
 * fragments and error text never leave this module: callers receive a
 * closed set of tag values only.
 */

export type BrowserRenderFamily =
  | 'home'
  | 'roster'
  | 'guild'
  | 'wars'
  | 'boss'
  | 'explore'
  | 'player'
  | 'auth'
  | 'account'
  | 'clusters'
  | 'tokens'
  | 'replays'
  | 'meta'
  | 'awards'
  | 'other'

export type BrowserRenderErrorCode =
  | 'REACT_INVALID_CHILD'
  | 'DOM_INSERT_TARGET_MISSING'
  | 'DOM_REMOVE_TARGET_MISSING'
  | 'DOM_NOT_FOUND'
  | 'REACT_RENDER_FAILURE'

export interface BrowserRenderErrorTags {
  source: 'react.error-boundary'
  operation: `browser.render.${BrowserRenderFamily}`
  error_code: BrowserRenderErrorCode
}

const FAMILY_BY_SEGMENT = new Map<string, BrowserRenderFamily>([
  ['root', 'home'],
  ['home', 'home'],
  ['dashboard', 'home'],
  ['roster', 'roster'],
  ['roster-development', 'roster'],
  ['guild-management', 'guild'],
  ['guild-ops', 'guild'],
  ['guild-settings', 'guild'],
  ['guild-teams', 'guild'],
  ['guild-trends', 'guild'],
  ['wars', 'wars'],
  ['war-room', 'wars'],
  ['war-explorer', 'wars'],
  ['boss', 'boss'],
  ['boss-assignments', 'boss'],
  ['boss-playbooks', 'boss'],
  ['explore', 'explore'],
  ['leaderboards', 'explore'],
  ['player-stats', 'player'],
  ['player-performance', 'player'],
  ['auth', 'auth'],
  ['onboarding', 'auth'],
  ['unauthorized', 'auth'],
  ['api-keys', 'account'],
  ['profile', 'account'],
  ['privacy-rights', 'account'],
  ['clusters', 'clusters'],
  ['token-usage', 'tokens'],
  ['replays', 'replays'],
  ['meta-atlas', 'meta'],
  ['achievements', 'awards'],
  ['votlw', 'awards']
])

const BLOCKED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const INVALID_CHILD_MESSAGE = 'Objects are not valid as a React child'
const MINIFIED_INVALID_CHILD = /^Minified React error #31(?:;|$)/u

const resolveFamily = (pathname: unknown): BrowserRenderFamily => {
  if (typeof pathname !== 'string' || pathname.length === 0) return 'other'
  // Location pathnames are absolute; reject protocol-like or opaque values.
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return 'other'

  const terminator = pathname.search(/[?#]/u)
  const pathOnly = terminator === -1 ? pathname : pathname.slice(0, terminator)
  if (pathOnly === '/') return 'home'

  // No decoding: encoded separators and private remainder stay uninspected.
  const firstSegment = pathOnly.split('/')[1] ?? ''
  if (firstSegment.length === 0) return 'other'
  if (BLOCKED_SEGMENTS.has(firstSegment)) return 'other'

  return FAMILY_BY_SEGMENT.get(firstSegment) ?? 'other'
}

const readStringField = (
  value: unknown,
  field: 'name' | 'message'
): string | undefined => {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return undefined
  }
  try {
    const fieldValue = (value as Record<string, unknown>)[field]
    return typeof fieldValue === 'string' ? fieldValue : undefined
  } catch {
    return undefined
  }
}

const resolveErrorCode = (error: unknown): BrowserRenderErrorCode => {
  const message =
    typeof error === 'string' ? error : readStringField(error, 'message')
  const name = readStringField(error, 'name')

  if (message) {
    if (
      message === INVALID_CHILD_MESSAGE ||
      message.startsWith(`${INVALID_CHILD_MESSAGE} (`) ||
      MINIFIED_INVALID_CHILD.test(message)
    ) {
      return 'REACT_INVALID_CHILD'
    }
  }

  if (name === 'NotFoundError') {
    if (message?.includes('insertBefore')) return 'DOM_INSERT_TARGET_MISSING'
    if (message?.includes('removeChild')) return 'DOM_REMOVE_TARGET_MISSING'
    return 'DOM_NOT_FOUND'
  }

  return 'REACT_RENDER_FAILURE'
}

export function browserRenderErrorTags(
  error: unknown,
  pathname: unknown
): BrowserRenderErrorTags {
  return {
    source: 'react.error-boundary',
    operation: `browser.render.${resolveFamily(pathname)}`,
    error_code: resolveErrorCode(error)
  }
}
