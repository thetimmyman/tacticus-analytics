import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const GET = withAdminGuards({ guard: 'app-admin' }, async () => {
  const supabase = serviceDb()

  const { data: thresholds, error } = await supabase
    .from('global_strength_thresholds')
    .select('*')
    .order('rarity')
    .order('strength_level')

  if (error) {
    throw Errors.database(error.message)
  }

  return NextResponse.json({ thresholds: thresholds || [] })
})
