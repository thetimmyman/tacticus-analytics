import { captureRequestError, withScope } from '@sentry/nextjs'
import type { Instrumentation } from 'next'

// React Flight aborts the render with this plain Error when the response stream closes early,
// i.e. the client went away; Next only filters AbortError/ResponseAborted, so we drop it here.
export const CLIENT_DISCONNECT_RENDER_ABORT =
  'The destination stream closed early.'

// Duck-typed on purpose: the error can come from another realm, where instanceof Error fails.
export function isClientDisconnectRenderAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    error.message === CLIENT_DISCONNECT_RENDER_ABORT
  )
}

const KNOWN_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS'
])
const KNOWN_ROUTE_TYPES = new Set(['render', 'route', 'action', 'proxy'])
const ROUTE_WORD = /^[a-z][a-z0-9-]{0,39}$/u

function routeSegmentTag(segment: string): string {
  return ROUTE_WORD.test(segment) ? segment : '_'
}

// The privacy scrubber strips URLs and transactions, so the route template is the only route
// signal left; groups and slots are dropped and every non-word segment becomes "_".
export function requestErrorTags(
  request: { method?: string },
  context: { routeType?: string; routePath?: string }
): { operation: string; source: string } {
  const method =
    request.method && KNOWN_METHODS.has(request.method)
      ? request.method
      : 'UNKNOWN'
  const segments = (context.routePath ?? '')
    .split('/')
    .filter(
      (segment) =>
        segment.length > 0 &&
        !/^\(.*\)$/u.test(segment) &&
        !segment.startsWith('@')
    )
  const last = segments.at(-1)
  if (last === 'page' || last === 'route') segments.pop()
  const route = segments.map(routeSegmentTag).join('.') || 'root'
  const routeType =
    context.routeType && KNOWN_ROUTE_TYPES.has(context.routeType)
      ? context.routeType
      : 'unknown'
  return {
    operation: `${method}:${route}`.slice(0, 80),
    source: `next.${routeType}`
  }
}

// Only page renders and server actions stream React Flight; route handlers and proxy never do.
const FLIGHT_ROUTE_TYPES = new Set(['render', 'action'])
const MAX_ERROR_TEXT_LENGTH = 16_384
const JSON_PARSE_SYNTAX_MESSAGE =
  /\bJSON\b|^Unexpected token\b|^Expected property name\b|^Unterminated string\b/iu
const SYNTAX_ERROR_HEADER_LINE = /^SyntaxError(?::|$)/u
const JSON_PARSE_FRAME = /^at\s+JSON\.parse\s*\(/u
const STACK_FRAME_WITH_LOC = /^at\s+(?:async\s+)?(.+?)\s+\(([^()]+)\)$/u
const STACK_FRAME_BARE_LOC =
  /^at\s+(?:async\s+)?((?:\/|app:\/\/\/|node:|file:\/\/)[^()\s]+)$/u
const NEXT_DIST_FILE =
  /^(?:file:\/\/)?(?:\/[A-Za-z0-9_.-]+)*\/?node_modules\/next\/dist\/[A-Za-z0-9_./@-]+(?::\d+){0,2}$/u
const NEXT_SSR_DIST_CHUNK =
  /^app:\/\/\/_next\/server\/chunks\/ssr\/node_modules_next_dist_[A-Za-z0-9_.-]+(?::\d+){0,2}$/u
const NEXT_ACTION_DECODER_FILE =
  /\/compiled\/next-server\/app-page(?:-turbo)?\.runtime\.(?:prod|dev)\.js(?::\d+){0,2}$|\/server\/app-render\/action-handler[^/]*(?::\d+){0,2}$/u
const NEXT_ACTION_DECODER_FN =
  /(?:^|\.)(?:decodeAction|decodeReply|decodeReplyFromBusboy|decodeFormState|parseActionArgs)\b/u
const NODE_INTERNAL_LOC =
  /^(?:node:[A-Za-z0-9_/-]+|internal\/[A-Za-z0-9_/-]+)(?::\d+){0,2}$/u

interface ParsedStackFrame {
  fn: string
  location: string
}

function parseStackFrame(line: string): ParsedStackFrame | null {
  const withLocation = STACK_FRAME_WITH_LOC.exec(line)
  if (withLocation) {
    return {
      fn: withLocation[1]?.trim() ?? '',
      location: withLocation[2]?.trim() ?? ''
    }
  }
  const bareLocation = STACK_FRAME_BARE_LOC.exec(line)
  if (bareLocation) {
    return {
      fn: '',
      location: bareLocation[1]?.trim() ?? ''
    }
  }
  return null
}

function isNextRuntimeLocation(location: string): boolean {
  if (!location || location.includes('..')) return false
  return NEXT_DIST_FILE.test(location) || NEXT_SSR_DIST_CHUNK.test(location)
}

function isNextActionDecoderFrame(frame: ParsedStackFrame): boolean {
  if (!isNextRuntimeLocation(frame.location)) return false
  return (
    NEXT_ACTION_DECODER_FILE.test(frame.location) ||
    NEXT_ACTION_DECODER_FN.test(frame.fn)
  )
}

function isAllowedRuntimeFrame(frame: ParsedStackFrame): boolean {
  return (
    isNextRuntimeLocation(frame.location) ||
    NODE_INTERNAL_LOC.test(frame.location)
  )
}

function readBoundedErrorString(
  value: unknown,
  field: 'name' | 'message' | 'stack'
): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const raw = (value as Record<string, unknown>)[field]
    return typeof raw === 'string' && raw.length <= MAX_ERROR_TEXT_LENGTH
      ? raw
      : undefined
  } catch {
    return undefined
  }
}

/**
 * True when Next.js's Server Action request decoder threw `SyntaxError` in `JSON.parse`
 * on a malformed client/scanner POST body and every frame on the stack is Next.js/Node runtime.
 */
export function isMalformedServerActionPayloadSyntaxError(
  error: unknown
): boolean {
  const isSyntax =
    error instanceof SyntaxError ||
    readBoundedErrorString(error, 'name') === 'SyntaxError'
  if (!isSyntax) return false

  const message = readBoundedErrorString(error, 'message')
  const stack = readBoundedErrorString(error, 'stack')
  if (!message || !stack) return false
  if (!JSON_PARSE_SYNTAX_MESSAGE.test(message)) return false

  const lines = stack
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return false

  const frameStart = SYNTAX_ERROR_HEADER_LINE.test(lines[0] ?? '') ? 1 : 0
  const frameLines = lines.slice(frameStart)
  if (frameLines.length < 2) return false
  if (!JSON_PARSE_FRAME.test(frameLines[0] ?? '')) return false

  const parsedFrames = frameLines.slice(1).map(parseStackFrame)
  if (parsedFrames.some((frame) => frame === null)) return false

  const runtimeFrames = parsedFrames as ParsedStackFrame[]
  const decoderFrame = runtimeFrames[0]
  if (!decoderFrame || !isNextActionDecoderFrame(decoderFrame)) return false

  return runtimeFrames.every(isAllowedRuntimeFrame)
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context
) => {
  if (
    FLIGHT_ROUTE_TYPES.has(context.routeType) &&
    isClientDisconnectRenderAbort(error)
  ) {
    return
  }
  if (
    context.routeType === 'action' &&
    isMalformedServerActionPayloadSyntaxError(error)
  ) {
    return
  }
  withScope((scope) => {
    scope.setTags(requestErrorTags(request, context))
    captureRequestError(error, request, context)
  })
}
