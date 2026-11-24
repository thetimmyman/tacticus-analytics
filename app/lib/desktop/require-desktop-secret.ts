import type { NextRequest } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { safeEqual } from '@/app/lib/auth/require-header-secret'

// Fail-closed: prefer DESKTOP_API_SECRET and fall back to CRON_SECRET only when unset.
export function requireDesktopApiSecret(req: NextRequest): void {
  const desktopSecret = process.env.DESKTOP_API_SECRET?.trim()
  const cronSecret = process.env.CRON_SECRET?.trim()
  const configuredSecret = desktopSecret || cronSecret

  if (!configuredSecret) {
    throw Errors.fromResponse(500, {
      error: 'DESKTOP_API_SECRET is not configured'
    })
  }

  const authHeader = req.headers.get('authorization')
  const expected = `Bearer ${configuredSecret}`
  if (!authHeader || !safeEqual(authHeader, expected)) {
    throw Errors.fromResponse(401, { error: 'Unauthorized' })
  }
}
