import type { NextRequest } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { safeEqual } from '@/app/lib/auth/require-header-secret'

// Fail-closed. Use the shared safeEqual: a naive length pre-check makes timingSafeEqual throw
// a 500 on multi-byte input instead of returning 401.
export function requireCronSecret(req: NextRequest): void {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw Errors.fromResponse(500, { error: 'CRON_SECRET is not configured' })
  }

  const expected = `Bearer ${cronSecret}`
  if (!authHeader || !safeEqual(authHeader, expected)) {
    throw Errors.fromResponse(401, { error: 'Unauthorized' })
  }
}
