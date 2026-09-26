import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.boss.identifiers')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

// boss_mapping is readable by any authenticated user, so no service client.
export const GET = withErrorHandler(async () => {
  try {
    const supabase = await db()

    const { data, error } = await supabase
      .from('boss_mapping')
      .select(
        `
        id,
        unit_id,
        boss_type,
        boss_name,
        encounter_index,
        icon_path,
        portrait_path,
        thumbnail_path,
        map_display_name,
        asset_slug
      `
      )
      .not('unit_id', 'is', null)
      .order('boss_type')

    if (error) throw error

    return NextResponse.json({
      bosses: data || [],
      count: data?.length || 0
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Boss identifiers error')
    throw Errors.fromResponse(500, {
      error: 'Failed to fetch boss identifiers',
      bosses: []
    })
  }
})
