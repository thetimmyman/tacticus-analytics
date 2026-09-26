import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse } from 'next/server'
import { listAccessGrants } from '@/app/lib/services/feature-release-service'

export const GET = withAdminGuards({ guard: 'app-admin-user-id' }, async () => {
  const grants = await listAccessGrants('alpha_tester')
  const testers = grants.map(({ access_level: _, ...rest }) => rest)
  return NextResponse.json({ testers })
})
