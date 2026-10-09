import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { SAVED_ASSIGNMENTS_BODY_BYTES } from '@/app/lib/boss-assignments/saved-assignments-input'
import { savedAssignmentRequest } from '@/app/lib/boss-assignments/saved-assignments'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (getRuntimeProfile() !== 'desktop')
    return NextResponse.json({ error: 'Method not available' }, { status: 405 })
  return NextResponse.json(
    await savedAssignmentRequest({
      params: request.nextUrl.searchParams,
      signal: request.signal,
      action: 'read'
    }),
    { headers: { 'Cache-Control': 'no-store' } }
  )
})

export const PUT = withErrorHandler(
  async (request: NextRequest) => {
    if (getRuntimeProfile() !== 'desktop')
      return NextResponse.json(
        { error: 'Method not available' },
        { status: 405 }
      )
    return NextResponse.json(
      await savedAssignmentRequest({
        params: request.nextUrl.searchParams,
        signal: request.signal,
        action: 'replace',
        body: request.body,
        contentType: request.headers.get('Content-Type')
      }),
      { headers: { 'Cache-Control': 'no-store' } }
    )
  },
  { maxJsonBodyBytes: () => SAVED_ASSIGNMENTS_BODY_BYTES }
)

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  if (getRuntimeProfile() !== 'desktop')
    return NextResponse.json({ error: 'Method not available' }, { status: 405 })
  return NextResponse.json(
    await savedAssignmentRequest({
      params: request.nextUrl.searchParams,
      signal: request.signal,
      action: 'clear',
      body: request.body
    }),
    { headers: { 'Cache-Control': 'no-store' } }
  )
})
