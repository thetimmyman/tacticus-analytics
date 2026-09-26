import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_RESET_COOKIE,
  AUTH_RESET_MAX_AGE,
  AUTH_RESET_VERSION,
  getAuthCookieNames
} from '@/app/lib/auth/reset-session'
import { validateRedirectPath } from '@/app/lib/auth/redirect'

export const dynamic = 'force-dynamic'

const COOKIE_PATH = '/'

const resolveCookieDomains = (hostname: string): Array<string | undefined> => {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')
  if (
    normalizedHostname === 'tacticusanalytics.com' ||
    normalizedHostname.endsWith('.tacticusanalytics.com')
  ) {
    return ['.tacticusanalytics.com', undefined]
  }

  return [undefined]
}

const expireCookie = (
  response: NextResponse,
  name: string,
  options: { domain?: string; secure: boolean }
) => {
  response.cookies.set(name, '', {
    path: COOKIE_PATH,
    maxAge: 0,
    expires: new Date(0),
    sameSite: 'lax',
    secure: options.secure,
    ...(options.domain ? { domain: options.domain } : {})
  })
}

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const { searchParams } = request.nextUrl
  const nextParam = searchParams.get('next')

  // A bare startsWith('/') accepts `//evil.com` and `/\evil.com`.
  const safeNext = validateRedirectPath(nextParam) ?? '/auth/login'

  const redirectUrl = new URL(safeNext, request.url)
  if (redirectUrl.pathname.startsWith('/auth/login')) {
    if (!redirectUrl.searchParams.has('reason')) {
      redirectUrl.searchParams.set('reason', 'reset')
    }
  }

  const response = NextResponse.redirect(redirectUrl)

  if (request.nextUrl.protocol === 'https:') {
    response.headers.set('Clear-Site-Data', '"cookies", "storage"')
  }
  response.headers.set('Cache-Control', 'no-store')

  const cookieDomains = resolveCookieDomains(request.nextUrl.hostname)
  const cookieNames = getAuthCookieNames()
  const secure =
    request.nextUrl.protocol === 'https:' ||
    process.env.NODE_ENV === 'production'

  for (const name of cookieNames) {
    cookieDomains.forEach((domain) =>
      expireCookie(response, name, { domain, secure })
    )
  }

  cookieDomains.forEach((domain) => {
    response.cookies.set(AUTH_RESET_COOKIE, AUTH_RESET_VERSION, {
      path: COOKIE_PATH,
      maxAge: AUTH_RESET_MAX_AGE,
      sameSite: 'lax',
      secure,
      ...(domain ? { domain } : {})
    })
  })

  return response
}
