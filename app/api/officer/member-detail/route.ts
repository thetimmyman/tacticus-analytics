/** Officer+, own guild, `officer_command_center`; runs the expensive analyze-member classification. */

import { serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { getLatestSeason } from '@/app/lib/utils/season'
import { analyzeMember } from '@/app/lib/officer-briefing/analyze-member'
import { requireActiveOfficerCommandAccess } from '../_shared/access'

export const GET = withErrorHandler(async (request: Request) => {
  const { guildCode } = await requireActiveOfficerCommandAccess()

  const { searchParams } = new URL(request.url)
  const displayName = searchParams.get('display_name')?.trim()
  if (!displayName) {
    throw Errors.fromResponse(400, { error: 'display_name is required' })
  }
  const season = searchParams.get('season')?.trim() || (await getLatestSeason())
  if (!season) {
    throw Errors.fromResponse(503, { error: 'Season data unavailable' })
  }

  const result = await analyzeMember({
    supabase: serviceDb(),
    guildCode,
    displayName,
    season,
    nowMs: Date.now()
  })

  return Response.json(result)
})
