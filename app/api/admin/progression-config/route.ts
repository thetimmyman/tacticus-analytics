import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { serviceDb } from '@/app/lib/db'

export const dynamic = 'force-dynamic'

export const GET = withAdminGuards({ guard: 'app-admin' }, async () => {
  const supabase = serviceDb()

  const { data, error } = await supabase
    .from('raid_progression_config')
    .select('*')
    .neq('scope', 'global')
    .order('scope')
    .order('is_active', { ascending: false })

  if (error) {
    throw Errors.database(error.message)
  }

  return NextResponse.json({ configs: data ?? [] })
})

export const PUT = withAdminGuards(
  { guard: 'app-admin' },
  async (request: NextRequest) => {
    const body = await request.json()
    const { id, is_active } = body as { id: string; is_active: boolean }

    if (!id || typeof is_active !== 'boolean') {
      throw Errors.fromResponse(400, { error: 'id and is_active are required' })
    }

    const supabase = serviceDb()

    const { data: target, error: fetchError } = await supabase
      .from('raid_progression_config')
      .select('scope')
      .eq('id', id)
      .single()

    if (fetchError || !target) {
      throw Errors.fromResponse(404, { error: 'Config not found' })
    }

    if (target.scope === 'global') {
      throw Errors.gone(
        'Global progression controls are retired; progression now comes from captured season lineups'
      )
    }

    // Separate UPDATEs could leave zero active rows on failure.
    const { error: updateError } = await supabase.rpc(
      'set_active_progression_config',
      { p_id: id, p_is_active: is_active }
    )

    if (updateError) {
      throw Errors.database(updateError.message)
    }

    return NextResponse.json({ success: true })
  }
)
