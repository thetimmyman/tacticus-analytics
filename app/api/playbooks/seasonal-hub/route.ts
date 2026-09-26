import { NextResponse } from 'next/server'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { loadSeasonalBossHubData } from '@/app/(dashboard)/boss-playbooks/seasonal-hub-data'
import type { PlaybooksData } from '@/app/(dashboard)/boss-playbooks/types'
import playbooks from '@/data/boss-playbooks/playbooks.json'

export const dynamic = 'force-dynamic'

interface AccessLevels {
  is_app_admin?: boolean
}

/** Same authenticated, RLS-aware path, so guild scope never comes from browser data. */
export const GET = withErrorHandler(async (request: Request) => {
  const startedAt = performance.now()
  try {
    const url = new URL(request.url)
    const rawSeason = url.searchParams.get('season')?.trim() ?? ''
    if (!/^\d{1,6}$/.test(rawSeason)) {
      throw Errors.validation('A valid season is required')
    }
    const requestedSeason = Number.parseInt(rawSeason, 10)

    const { user, profile } = await requireActiveMembershipForApi()
    const access = await checkFeatureAccess(user.id, 'boss_playbooks')
    if (!access.has_access) {
      throw Errors.forbidden('Boss Playbooks requires alpha access', {
        stage: access.stage,
        reason: access.reason
      })
    }

    // No app-admin bypass.
    const canManageHerald = canManageHeraldRole(profile.role)
    const canManageTargets =
      canManageHerald || Boolean((profile as AccessLevels).is_app_admin)
    const hub = await loadSeasonalBossHubData(playbooks as PlaybooksData, {
      guildCode: profile.guild_code ?? null,
      canManageHerald,
      canManageTargets,
      seasonNumber: requestedSeason
    })

    if (!hub || hub.seasonNumber !== requestedSeason) {
      throw Errors.notFound('Seasonal boss lineup')
    }

    const duration = Math.max(0, performance.now() - startedAt)
    return NextResponse.json(
      { hub },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'Server-Timing': `seasonal-hub;dur=${duration.toFixed(1)}`,
          'X-Content-Type-Options': 'nosniff'
        }
      }
    )
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    throw Errors.internal('Failed to load seasonal boss playbooks', {
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
