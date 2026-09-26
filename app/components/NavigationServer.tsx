/** Pre-fetches the latest season and guild theme for navigation. */

import { getLatestSeason } from '@/app/lib/utils/season'
import Navigation from '@/app/components/Navigation'
import { db } from '@/app/lib/db'
import { getGuildTheme } from '@/app/lib/theme-system'
import {
  getUserAccessLevels,
  getAllFeatureReleaseStages,
  type UserAccessLevels,
  type FeatureReleaseStages
} from '@/app/lib/services/feature-release-service'
import { getServerClusterContext } from '@/app/lib/auth/cached-auth'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import {
  resolveAvatarFrameMap,
  resolveAvatarIconUrl
} from '@/app/lib/utils/avatar'
import { AlphaChromeBar } from '@/app/components/navigation/AlphaChromeBar'
import { resolveServerNavigationRole } from '@/app/components/navigation/server-role-authority'
import type { UserRole } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging/client'
import type { MembershipStatus } from '@/app/types'
const logger = createComponentLogger('components.NavigationServer')

interface NavigationUser {
  id: string
  role?: UserRole | null
  membershipStatus?: MembershipStatus
}

interface NavigationProfile {
  user_id: string | null
  role?: string | null
  guild_code?: string | null
  avatar_unit_id?: string | null
  avatar_url?: string | null
}

interface NavigationServerProps {
  user?: NavigationUser | null
  profile?: NavigationProfile | null
  hideAnalytics?: boolean
}

interface GuildThemeData {
  guild_code: string
  display_name: string
  primary_color: string
  secondary_color: string
  accent_color: string
  logo_url?: string
  theme_name: string
}

export async function NavigationServer({
  user,
  profile,
  hideAnalytics = false
}: NavigationServerProps) {
  // getAuthUser keeps the last mapping for inactive accounts (recovery screens), but
  // it is not navigation authority: scrub it so public pages cannot resurrect role,
  // guild, grants, theme or avatar.
  const isInactiveMembership = user?.membershipStatus === 'inactive'
  const navigationProfile = isInactiveMembership ? null : profile
  const navigationHideAnalytics = hideAnalytics || isInactiveMembership

  let latestSeason = '81'
  let hasCluster = false
  let userAccessLevels: UserAccessLevels | null = null
  let featureReleaseStages: FeatureReleaseStages = {}
  let avatarUrl: string | null = null

  const seasonPromise = getLatestSeason().catch((error) => {
    logger.error({ err: error }, 'Error fetching latest season:')
    return latestSeason
  })

  if (navigationProfile?.user_id && user?.id) {
    try {
      // Parallel lookups; seasonPromise is awaited once below so it survives a throw here.
      const supabase = await db()
      const [clusterContext, accessLevels, releaseStages, playerMappingResult] =
        await Promise.all([
          getServerClusterContext(navigationProfile.user_id),
          getUserAccessLevels(user.id),
          getAllFeatureReleaseStages(),
          supabase
            .from(CURRENT_USER_PLAYER_MAPPING)
            .select('avatar_unit_id')
            .eq('user_id', user.id)
            .eq('is_current', true)
            .single()
        ])

      hasCluster = !!clusterContext.clusterCode
      userAccessLevels = accessLevels
      featureReleaseStages = releaseStages

      const avatarUnitId = playerMappingResult.data?.avatar_unit_id

      // No datamine fallback: a miss uses profile.avatar_url, not a possibly-404 URL.
      if (avatarUnitId) {
        const frameMap = await resolveAvatarFrameMap(supabase, avatarUnitId)

        avatarUrl = resolveAvatarIconUrl(avatarUnitId, frameMap, {
          datamineFallback: false
        })
      }
    } catch (error) {
      logger.error({ err: error }, 'Error fetching cluster info:')
    }
  }

  // Single consumption point for the season fetch; null falls back to the chrome default.
  latestSeason = (await seasonPromise) ?? latestSeason

  const enrichedProfile = navigationProfile
    ? {
        ...navigationProfile,
        avatar_url: avatarUrl || navigationProfile.avatar_url
      }
    : null

  let guildThemeData: GuildThemeData | null = null

  if (navigationProfile?.guild_code) {
    try {
      const guildTheme = getGuildTheme(navigationProfile.guild_code)

      if (guildTheme) {
        guildThemeData = {
          guild_code: navigationProfile.guild_code,
          display_name: guildTheme.name,
          primary_color: guildTheme.primary,
          secondary_color: guildTheme.secondary,
          accent_color: guildTheme.accent,
          theme_name: navigationProfile.guild_code
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Error fetching guild theme:')
      // No fallback: Navigation handles a missing theme.
    }
  }

  // <Navigation> gets the same resolved role so its onboarding branch cannot diverge.
  const effectiveRole = isInactiveMembership
    ? 'member'
    : resolveServerNavigationRole(enrichedProfile, user)
  const isAppAdmin = !!(
    enrichedProfile &&
    'is_app_admin' in enrichedProfile &&
    (enrichedProfile as { is_app_admin?: boolean | null }).is_app_admin
  )
  const hasProfile = !!enrichedProfile
  const showWorkspaceChrome = !!user && effectiveRole !== 'onboarding'

  return (
    <>
      {showWorkspaceChrome && (
        <AlphaChromeBar
          effectiveRole={effectiveRole}
          isAppAdmin={isAppAdmin}
          hideAnalytics={navigationHideAnalytics}
          hasProfile={hasProfile}
          userAccessLevels={userAccessLevels}
          featureReleaseStages={featureReleaseStages}
          user={user}
          profile={enrichedProfile}
          guildThemeData={guildThemeData}
          hasCluster={hasCluster}
          initialLatestSeason={latestSeason}
        />
      )}
      <Navigation
        user={user ?? undefined}
        profile={isInactiveMembership ? null : (enrichedProfile ?? undefined)}
        initialLatestSeason={latestSeason}
        guildThemeData={guildThemeData}
        hasCluster={hasCluster}
        hideAnalytics={navigationHideAnalytics}
        userAccessLevels={userAccessLevels}
        featureReleaseStages={featureReleaseStages}
        effectiveRole={effectiveRole}
      />
    </>
  )
}
