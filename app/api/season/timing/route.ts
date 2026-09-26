import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'

export const dynamic = 'force-dynamic'

async function handler(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const seasonParam = searchParams.get('season')

  const seasonNumber = seasonParam
    ? Number.parseInt(seasonParam, 10)
    : undefined
  if (
    seasonParam &&
    (!Number.isFinite(seasonNumber) ||
      (seasonNumber != null && seasonNumber < 1))
  ) {
    return NextResponse.json(
      { error: 'Invalid season parameter' },
      { status: 400 }
    )
  }

  const timing = await getSeasonTiming(seasonNumber)

  return NextResponse.json(timing, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60'
    }
  })
}

export const GET = withErrorHandler(handler)
