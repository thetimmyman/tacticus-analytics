import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const GET = withAdminGuards({ guard: 'app-admin' }, async () => {
  const supabase = await db()

  const { data: features, error } = await supabase
    .from('feature_releases')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    throw Errors.database(error.message)
  }

  return NextResponse.json({ features: features || [] })
})
