import type { NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { UserRole } from '@tacticus/app-core/types'
import type { AuthData } from '@/app/lib/auth'
import { requireRoleForApi } from '@/app/lib/auth'
import {
  requireAppAdminForApi,
  requireCurrentAppAdminForApi,
  type RequireCurrentAppAdminForApiOptions
} from '@/app/lib/auth/app-admin'
import { requireAppAdmin } from '@/app/lib/services/feature-release-service'
import { db } from '@/app/lib/db'
import { apiSecurityMiddleware } from '@/app/lib/middleware/api-security-middleware'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

/**
 * Entry point for every admin route: the rate limiter runs before the handler, and the guard is a declared
 * value that scripts/security/check-admin-route-guards.mjs censuses. `guild-role`/`in-handler` need a `reason`.
 */

export type AppAdminGuardOptions = {
  guard: 'app-admin'
  deniedMetadata?: Record<string, unknown>
}

export type AppAdminUserIdGuardOptions = {
  guard: 'app-admin-user-id'
}

export type AppAdminSessionGuardOptions = {
  guard: 'app-admin-session'
} & RequireCurrentAppAdminForApiOptions

export type GuildRoleGuardOptions = {
  guard: 'guild-role'
  minRole: UserRole
  /** Why the caller's OWN guild is the right scope for this route. */
  reason: string
}

export type InHandlerGuardOptions = {
  guard: 'in-handler'
  /** Why the authorization cannot be hoisted into the wrapper. */
  reason: string
}

export type AdminGuardOptions =
  | AppAdminGuardOptions
  | AppAdminUserIdGuardOptions
  | AppAdminSessionGuardOptions
  | GuildRoleGuardOptions
  | InHandlerGuardOptions

export type AdminGuardAuth<O extends AdminGuardOptions> =
  O extends AppAdminUserIdGuardOptions
    ? { user_id: string }
    : O extends AppAdminSessionGuardOptions
      ? { user: User }
      : O extends InHandlerGuardOptions
        ? null
        : AuthData

async function resolveGuard(options: AdminGuardOptions): Promise<unknown> {
  switch (options.guard) {
    case 'app-admin':
      return requireAppAdminForApi({ deniedMetadata: options.deniedMetadata })
    case 'app-admin-user-id':
      return requireAppAdmin()
    case 'app-admin-session':
      return requireCurrentAppAdminForApi(await db(), options)
    case 'guild-role':
      return requireRoleForApi(options.minRole)
    case 'in-handler':
      return null
  }
}

/** Next type-checks handlers against RouteHandlerConfig, so the resolved caller is a THIRD argument. */
export function withAdminGuards<O extends AdminGuardOptions, C = unknown>(
  options: O,
  handler: (
    request: NextRequest,
    context: C,
    auth: AdminGuardAuth<O>
  ) => Promise<Response> | Response
) {
  return withErrorHandler(async (request: NextRequest, context: C) => {
    // IP-keyed, before the guard so an unauthenticated flood cannot amplify via auth round-trips.
    // skipSecurityChecks: the bot filter would reject curl/scripts.
    const limited = await apiSecurityMiddleware(request, {
      skipSecurityChecks: true
    })
    if (limited) return limited

    const auth = (await resolveGuard(options)) as AdminGuardAuth<O>

    return handler(request, context, auth)
  })
}
