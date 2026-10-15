import { NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { readRosterVerificationSummary } from '@/app/lib/player/roster-snapshot-store'

export const dynamic = 'force-dynamic'
export const GET = withErrorHandler(async () => {
  const desktop = getRuntimeProfile() === 'desktop'
  const { profile } = await requireRoleForApi(desktop ? 'member' : 'officer')
  if (desktop || !profile.guild_code)
    return NextResponse.json({ available: false })
  const supabase = serviceDb()
  const { data, error } = await supabase
    .from('player_mapping')
    .select('id')
    .eq('guild_code', profile.guild_code)
    .eq('is_current', true)
    .abortSignal(AbortSignal.timeout(5000))
  if (error) throw new Error('Roster verification unavailable')
  const summary = await readRosterVerificationSummary(
    (data ?? []).map((row) => row.id),
    6 * 60 * 60 * 1000,
    supabase
  )
  return NextResponse.json({ available: true, ...summary })
})
