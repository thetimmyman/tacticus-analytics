import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const PUT = withAdminGuards(
  { guard: 'app-admin' },
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params
    const body = await request.json()
    const {
      min_rank,
      min_rank_index,
      min_ability_active,
      min_ability_passive,
      notes
    } = body

    if (min_rank === undefined || min_rank_index === undefined) {
      throw Errors.validation('min_rank and min_rank_index are required')
    }

    if (min_rank_index < 0 || min_rank_index > 23) {
      throw Errors.validation('min_rank_index must be between 0 and 23')
    }

    const supabase = serviceDb()

    const { data: threshold, error } = await supabase
      .from('global_strength_thresholds')
      .update({
        min_rank,
        min_rank_index,
        min_ability_active: min_ability_active ?? null,
        min_ability_passive: min_ability_passive ?? null,
        notes: notes ?? null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw Errors.database(error.message)
    }

    if (!threshold) {
      throw Errors.notFound('Threshold not found')
    }

    return NextResponse.json({ threshold })
  }
)
