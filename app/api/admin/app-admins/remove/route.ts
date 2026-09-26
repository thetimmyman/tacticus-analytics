import { NextRequest, NextResponse } from 'next/server'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { Errors } from '@/app/lib/errors/AppError'
import { removeAppAdmin } from '@/app/lib/services/feature-release-service'

export const POST = withAdminGuards(
  { guard: 'app-admin-user-id' },
  async (request: NextRequest, _context, { user_id }) => {
    const { email } = await request.json()
    if (!email) throw Errors.validation('Email is required')

    await removeAppAdmin(email, user_id)
    return NextResponse.json({ success: true })
  }
)
