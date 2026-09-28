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
  withScope((scope) => {
    scope.setTags(requestErrorTags(request, context))
    captureRequestError(error, request, context)
  })
}
