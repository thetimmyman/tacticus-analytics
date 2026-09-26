import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

const logger = createComponentLogger('herald-available-meta-teams')

// Ordered like other meta-team surfaces.

export interface AvailableMetaTeam {
  team_name: string
  description: string | null
}

export const GET = withErrorHandler(async () => {
  const supabase = await db()
  await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/available-meta-teams'
    })
  )

  const { data, error } = await supabase
    .from('meta_teams')
    .select('team_name, description, sort_order')
    .order('sort_order', { ascending: true })
    .order('team_name', { ascending: true })

  if (error) {
    logger.error({ err: error }, 'Error fetching meta teams')
    throw Errors.fetchFailed('Failed to fetch meta teams', {
      endpoint: '/api/herald/available-meta-teams',
      details: error.message
    })
  }

  const teams: AvailableMetaTeam[] = (data ?? []).map((row) => ({
    team_name: row.team_name,
    description: row.description ?? null
  }))

  return NextResponse.json({ success: true, teams })
})
