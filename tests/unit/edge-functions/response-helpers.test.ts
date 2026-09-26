import { describe, it, expect } from 'vitest'

type JsonResponseOptions = {
  status?: number
  headers?: Record<string, string>
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type'
}

function jsonResponse(
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

function successResponse(
  data: unknown,
  options: JsonResponseOptions = {}
): Response {
  return jsonResponse(data, { status: 200, ...options })
}

function errorResponse(
  message: string,
  status = 500,
  details?: unknown
): Response {
  const body: Record<string, unknown> = {
    success: false,
    error: message
  }
  if (details !== undefined) {
    body.details = details
  }
  return jsonResponse(body, { status })
}

function badRequestResponse(message: string, details?: unknown): Response {
  return errorResponse(message, 400, details)
}

function notFoundResponse(message: string, details?: unknown): Response {
  return errorResponse(message, 404, details)
}

function unauthorizedResponse(message = 'Unauthorized'): Response {
  return errorResponse(message, 401)
}

function corsOptionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders })
}

describe('Edge Function: response-helpers', () => {
  describe('jsonResponse', () => {
    it('returns JSON response with cors headers and default status', async () => {
      const response = jsonResponse({ ok: true })
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(await response.json()).toEqual({ ok: true })
    })

    it('merges custom headers and status', async () => {
      const response = jsonResponse(
        { ok: true },
        {
          status: 201,
          headers: {
            'Content-Type': 'application/vnd.test+json',
            'X-Request-Id': 'abc123'
          }
        }
      )
      expect(response.status).toBe(201)
      expect(response.headers.get('Content-Type')).toBe(
        'application/vnd.test+json'
      )
      expect(response.headers.get('X-Request-Id')).toBe('abc123')
      expect(await response.json()).toEqual({ ok: true })
    })
  })

  describe('successResponse', () => {
    it('returns a 200 response by default', async () => {
      const response = successResponse({ ok: true })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    })

    it('allows custom status overrides', () => {
      const response = successResponse({ ok: true }, { status: 202 })
      expect(response.status).toBe(202)
    })
  })

  describe('errorResponse', () => {
    it('returns error payload with default status', async () => {
      const response = errorResponse('Something went wrong')
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toEqual({ success: false, error: 'Something went wrong' })
    })

    it('includes details when provided', async () => {
      const response = errorResponse('Bad data', 422, { field: 'name' })
      expect(response.status).toBe(422)
      const body = await response.json()
      expect(body).toEqual({
        success: false,
        error: 'Bad data',
        details: { field: 'name' }
      })
    })

    it('omits details when undefined', async () => {
      const response = errorResponse('No details', 400)
      const body = await response.json()
      expect('details' in body).toBe(false)
    })
  })

  describe('badRequestResponse', () => {
    it('returns a 400 error response', async () => {
      const response = badRequestResponse('Invalid', { field: 'guildCode' })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Invalid',
        details: { field: 'guildCode' }
      })
    })
  })

  describe('notFoundResponse', () => {
    it('returns a 404 error response', async () => {
      const response = notFoundResponse('Missing')
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Missing'
      })
    })
  })

  describe('unauthorizedResponse', () => {
    it('returns a 401 error response with default message', async () => {
      const response = unauthorizedResponse()
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Unauthorized'
      })
    })

    it('returns a 401 error response with custom message', async () => {
      const response = unauthorizedResponse('Nope')
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Nope'
      })
    })
  })

  describe('corsOptionsResponse', () => {
    it('returns ok with cors headers', async () => {
      const response = corsOptionsResponse()
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Content-Type')).toBe(
        'text/plain;charset=UTF-8'
      )
      expect(await response.text()).toBe('ok')
    })
  })
})
