import { corsHeaders } from './cors-headers.ts'

export interface JsonResponseOptions {
  status?: number
  headers?: Record<string, string>
}

export function jsonResponse(
  data: unknown,
  options: JsonResponseOptions = {}
): Response {
  const { status = 200, headers = {} } = options
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...headers
    }
  })
}

export function successResponse(
  data: unknown,
  options: JsonResponseOptions = {}
): Response {
  return jsonResponse(data, { status: 200, ...options })
}

export function errorResponse(
  message: string,
  status = 500,
  details?: unknown
): Response {
  const body: Record<string, unknown> = {
    success: false,
    error: status >= 500 ? 'Internal server error' : message
  }
  if (details !== undefined && status < 500) {
    body.details = details
  }
  return jsonResponse(body, { status })
}

export function badRequestResponse(
  message: string,
  details?: unknown
): Response {
  return errorResponse(message, 400, details)
}

export function notFoundResponse(message: string, details?: unknown): Response {
  return errorResponse(message, 404, details)
}

export function unauthorizedResponse(message = 'Unauthorized'): Response {
  return errorResponse(message, 401)
}

export function corsOptionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders })
}
