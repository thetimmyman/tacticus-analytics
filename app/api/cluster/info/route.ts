import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { fetchClusterDetails } from '@/app/lib/services/guild-settings-service'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const clusterCode = request.nextUrl.searchParams.get('code')

  if (!clusterCode) {
    throw Errors.validation('Missing cluster code')
  }

  await requireRoleForApi('officer')
  const cluster = await fetchClusterDetails(clusterCode)

  return NextResponse.json({ success: true, data: cluster }, { status: 200 })
})
