import { NextRequest } from 'next/server'

export interface MockRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  searchParams?: Record<string, string>
}

export const createMockRequest = (
  path: string,
  options: MockRequestOptions = {}
): NextRequest => {
  const url = new URL(path, 'http://localhost:3000')

  if (options.searchParams) {
    Object.entries(options.searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
  }

  const init: RequestInit = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  }

  if (options.body && options.method !== 'GET') {
    init.body = JSON.stringify(options.body)
  }

  return new NextRequest(url, init)
}

export const createMockGetRequest = (
  path: string,
  searchParams?: Record<string, string>,
  headers?: Record<string, string>
): NextRequest => {
  return createMockRequest(path, { method: 'GET', searchParams, headers })
}

export const createMockPostRequest = (
  path: string,
  body: unknown,
  headers?: Record<string, string>
): NextRequest => {
  return createMockRequest(path, { method: 'POST', body, headers })
}

export interface JsonResponseAssertion {
  status: number
  body?: unknown
  bodyContains?: Record<string, unknown>
}

export const expectJsonResponse = async (
  response: Response,
  expected: JsonResponseAssertion
): Promise<unknown> => {
  expect(response.status).toBe(expected.status)

  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    const body = await response.json()

    if (expected.body !== undefined) {
      expect(body).toEqual(expected.body)
    }

    if (expected.bodyContains) {
      Object.entries(expected.bodyContains).forEach(([key, value]) => {
        expect(body).toHaveProperty(key)
        if (value !== undefined) {
          expect(body[key]).toEqual(value)
        }
      })
    }

    return body
  }

  return null
}

export const expectTextResponse = async (
  response: Response,
  status: number,
  textContains?: string
): Promise<string> => {
  expect(response.status).toBe(status)

  const text = await response.text()

  if (textContains) {
    expect(text).toContain(textContains)
  }

  return text
}

export const expectErrorResponse = async (
  response: Response,
  status: number,
  errorMessage?: string
): Promise<void> => {
  expect(response.status).toBe(status)

  if (errorMessage) {
    const body = await response.json()
    const message =
      typeof body.error === 'object'
        ? body.error.message
        : body.error || body.message
    expect(message).toContain(errorMessage)
  }
}

/** Error message from either `{ error: string }` or the ErrorEnvelope `{ error: { message } }`. */
const getErrorMessage = (body: Record<string, unknown>): string | undefined => {
  if (typeof body.error === 'object' && body.error !== null) {
    return (body.error as { message?: string }).message
  }
  if (typeof body.error === 'string') {
    return body.error
  }
  if (typeof body.message === 'string') {
    return body.message
  }
  return undefined
}
