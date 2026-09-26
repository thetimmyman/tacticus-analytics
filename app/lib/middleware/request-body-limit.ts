import { NextRequest, NextResponse } from 'next/server'

export const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024

export function enforceJsonBodyLimit(
  request: NextRequest | undefined
): NextResponse | null {
  if (!request) return null

  if (
    !['POST', 'PUT', 'PATCH'].includes((request.method ?? 'GET').toUpperCase())
  ) {
    return null
  }

  const rawContentLength = request.headers.get('content-length')
  const contentLength = rawContentLength ? Number(rawContentLength) : NaN
  if (!Number.isFinite(contentLength) || contentLength < MAX_JSON_BODY_BYTES) {
    return null
  }

  return NextResponse.json(
    { error: 'Payload too large', maxBytes: MAX_JSON_BODY_BYTES },
    { status: 413 }
  )
}
