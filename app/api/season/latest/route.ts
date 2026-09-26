import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'

export const dynamic = 'force-dynamic'

/** Browsers must not call `get_latest_season`: SECURITY INVOKER, seq-scans "EOT_GR_data" under RLS. */
async function handler() {
  const season = await getLatestSeason()
  return NextResponse.json(
    { season },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60'
      }
    }
  )
}

export const GET = withErrorHandler(handler)
