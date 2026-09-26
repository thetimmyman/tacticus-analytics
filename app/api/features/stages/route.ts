import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const GET = withErrorHandler(async () => {
  try {
    const supabase = await db()

    const { data: features, error } = await supabase
      .from('feature_releases')
      .select('feature_key, release_stage')

    if (error) {
      throw Errors.fromResponse(500, { error: error.message })
    }

    const stages: Record<string, string> = {}
    for (const feature of features || []) {
      stages[feature.feature_key] = feature.release_stage
    }

    return NextResponse.json(stages, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
      }
    })
  } catch (err) {
    rethrowIfAppError(err)
    throw Errors.fromResponse(500, {
      error: err instanceof Error ? err.message : 'Internal error'
    })
  }
})
