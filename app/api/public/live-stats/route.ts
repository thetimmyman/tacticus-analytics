import { NextResponse } from 'next/server'
import { getLiveStats } from '@/app/lib/data/get-live-stats'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.public.live-stats')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler(async () => {
  try {
    const stats = await getLiveStats()

    return NextResponse.json(stats, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store'
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(error, 'Failed to fetch live stats from API route:')

    throw Errors.fromResponse(500, {
      message: 'Unable to load live stats right now.'
    })
  }
})
