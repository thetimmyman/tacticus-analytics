import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse } from 'next/server'
import { listAppAdmins } from '@/app/lib/services/feature-release-service'

export const GET = withAdminGuards({ guard: 'app-admin-user-id' }, async () => {
  const admins = await listAppAdmins()
  return NextResponse.json({ admins })
})
