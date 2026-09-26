import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const POST = withAdminGuards(
  { guard: 'app-admin' },
  async (request: NextRequest) => {
    const { feature_key, new_stage } = await request.json()

    if (!feature_key || !new_stage) {
      throw Errors.validation('Missing required fields', {
        feature_key,
        new_stage
      })
    }

    const validStages = ['alpha', 'beta', 'coming_soon', 'public']
    if (!validStages.includes(new_stage)) {
      throw Errors.validation(
        `Invalid stage: ${new_stage}. Must be one of: ${validStages.join(', ')}`
      )
    }

    const supabase = await db()

    const { data, error } = await supabase.rpc('admin_update_feature_stage', {
      p_feature_key: feature_key,
      p_new_stage: new_stage
    })

    if (error) {
      throw Errors.database(error.message)
    }

    const result = data as { success: boolean; error?: string }

    if (!result.success) {
      throw Errors.validation(result.error || 'Failed to update feature stage')
    }

    return NextResponse.json({ success: true })
  }
)
