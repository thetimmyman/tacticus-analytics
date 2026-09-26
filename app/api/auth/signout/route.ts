import { NextResponse } from 'next/server'
import { signOut } from '@/app/lib/auth'
import { APP_ORIGINS } from '@tacticus/app-core/app-config'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler(async (): Promise<Response> => {
  await signOut()

  const baseUrl = APP_ORIGINS.CURRENT
  return NextResponse.redirect(new URL('/', baseUrl))
})
