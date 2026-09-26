import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

const logger = createComponentLogger('meta-teams')

// Includes id (the player_meta_roles FK), unlike /api/herald/available-meta-teams.

export interface MetaTeamRow {
  id: string
  team_name: string
  description: string | null
  sort_order: number | null
}

export const GET = withErrorHandler(async () => {
  const supabase = await db()
  await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/meta-teams'
    })
  )

  const { data, error } = await supabase
    .from('meta_teams')
    .select('id, team_name, description, sort_order')
    .order('sort_order', { ascending: true })
    .order('team_name', { ascending: true })

  if (error) {
    logger.error({ err: error }, 'Error fetching meta teams')
    throw Errors.fetchFailed('Failed to fetch meta teams', {
      endpoint: '/api/meta-teams',
      details: error.message
    })
  }

  const teams: MetaTeamRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    team_name: row.team_name as string,
    description: (row.description as string | null) ?? null,
    sort_order: (row.sort_order as number | null) ?? null
  }))

  return NextResponse.json({ success: true, teams })
})
