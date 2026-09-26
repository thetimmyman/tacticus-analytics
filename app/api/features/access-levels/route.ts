import { NextRequest, NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { getUserAccessLevels } from '@/app/lib/services/feature-release-service'
import {
  withErrorHandler,
  rethrowIfAuthError
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const GET = withErrorHandler(async (_request: NextRequest) => {
  try {
    const authData = await requireAuthForApi()

    const levels = await getUserAccessLevels(authData.user.id)

    return NextResponse.json(levels, {
      headers: {
        'Cache-Control': 'private, max-age=60'
      }
    })
  } catch (err) {
    rethrowIfAppError(err)
    rethrowIfAuthError(err)
    throw Errors.fromResponse(500, {
      error: err instanceof Error ? err.message : 'Internal error'
    })
  }
})
