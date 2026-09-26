import { NextResponse, type NextRequest } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import {
  removeAccessGrant,
  type AccessLevel
} from '@/app/lib/services/feature-release-service'

export function createRemoveAccessGrantHandler(accessLevel: AccessLevel) {
  return withAdminGuards(
    { guard: 'app-admin-user-id' },
    async (request: NextRequest) => {
      const { email } = (await request.json()) as { email?: string }
      if (!email) throw Errors.validation('Email is required')

      await removeAccessGrant(email, accessLevel)
      return NextResponse.json({ success: true })
    }
  )
}
