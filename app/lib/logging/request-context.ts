import { NextRequest } from 'next/server'
import {
  setTag as setSentryTag,
  setContext as setSentryContext
} from '@sentry/nextjs'
import {
  createRequestLogger,
  generateRequestId,
  logApiCall,
  logError,
  type PinoLogger,
  type RequestContext
} from './logger'
import { associateRequestId } from './correlation-id'

const REQUEST_ID_HEADER = 'x-request-id'

export interface ApiRequestContext {
  requestId: string
  log: PinoLogger
  startTime: number
}

export type ApiHandler<T = Response> = (
  req: NextRequest,
  ctx: ApiRequestContext,
  routeContext?: { params: Promise<Record<string, string>> }
) => Promise<T>

export function withRequestContext<T extends Response>(handler: ApiHandler<T>) {
  return async (
    req: NextRequest,
    routeContext?: { params: Promise<Record<string, string>> }
  ): Promise<Response> => {
    // Always mint the ID: an incoming x-request-id is unauthenticated and could
    // smuggle a user/player UUID past log redaction.
    const requestId = generateRequestId()
    associateRequestId(req, requestId)
    const startTime = Date.now()

    // Log only the pathname; query params may contain sensitive data.
    const url = new URL(req.url)
    const pathname = url.pathname

    const context: RequestContext = {
      requestId,
      method: req.method,
      url: pathname
    }

    const log = createRequestLogger(context)
    log.info('Request started')

    try {
      setSentryTag('request_id', requestId)
      setSentryContext('request', {
        requestId,
        method: req.method,
        url: pathname
      })
    } catch {
      // Sentry might not be initialized in all environments
    }

    const apiContext: ApiRequestContext = {
      requestId,
      log,
      startTime
    }

    try {
      const response = await handler(req, apiContext, routeContext)

      const durationMs = Date.now() - startTime

      const status = response instanceof Response ? response.status : 200
      logApiCall(log, req.method, pathname, status, durationMs)

      if (response instanceof Response) {
        const newHeaders = new Headers(response.headers)
        newHeaders.set(REQUEST_ID_HEADER, requestId)

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        })
      }

      return response
    } catch (error) {
      const durationMs = Date.now() - startTime

      logError(log, error, 'Request failed', {
        durationMs,
        method: req.method,
        url: pathname
      })

      throw error
    }
  }
}
