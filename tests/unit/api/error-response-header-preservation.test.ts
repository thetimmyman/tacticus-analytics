/** Only an AppError-shaped body keeps its response; anything else loses the route's (privacy) headers. */
import { describe, it, expect } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { AppError } from '@/app/lib/errors/AppError'

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
}

function request(): NextRequest {
  return new NextRequest('http://localhost/api/anything')
}

describe('withErrorHandler — route header preservation on error responses', () => {
  it('preserves route headers when the error body is AppError-shaped', async () => {
    const handler = withErrorHandler(async () =>
      NextResponse.json(
        new AppError(
          'REPLAY_CONVERSION_FAILED',
          'Conversion failed',
          422
        ).toJSON(),
        { status: 422, headers: PRIVATE_HEADERS }
      )
    )

    const response = await handler(request())

    expect(response.status).toBe(422)
    for (const [header, value] of Object.entries(PRIVATE_HEADERS)) {
      expect(response.headers.get(header)).toBe(value)
    }
  })

  it('DROPS route headers when the error body is a bare string (the defect shape)', async () => {
    // Fails if the normalizer ever preserves headers unconditionally.
    const handler = withErrorHandler(async () =>
      NextResponse.json(
        { error: 'Conversion failed' },
        { status: 422, headers: PRIVATE_HEADERS }
      )
    )

    const response = await handler(request())

    expect(response.status).toBe(422)
    expect(response.headers.get('Cache-Control')).not.toBe('private, no-store')
  })
})
