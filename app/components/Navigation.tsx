'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import type { PlayerMapping, UserRole } from '@tacticus/app-core/types'
import type {
  UserAccessLevels,
  FeatureReleaseStages
} from '@/app/lib/services/feature-release-service'
import { MobileNav } from './navigation/MobileNav'
import { PublicNav } from './navigation/PublicNav'
import { OnboardingNav } from './navigation/OnboardingNav'

interface GuildThemeData {
  guild_code: string
  display_name: string
  primary_color: string
  secondary_color: string
  accent_color: string
  logo_url?: string
  theme_name: string
}

interface NavigationProfile {
  user_id?: string | null
  role?: string | null
  guild_code?: string | null
  display_name?: string | null
  is_app_admin?: boolean | null
  avatar_url?: string | null
}

interface NavigationProps {
  user?: { id: string; email?: string }
  profile?: NavigationProfile | PlayerMapping | null
  initialLatestSeason?: string
  guildThemeData?: GuildThemeData | null
  hasCluster?: boolean
  hideAnalytics?: boolean
  userAccessLevels?: UserAccessLevels | null
  featureReleaseStages?: FeatureReleaseStages
  /** Server-resolved; do not re-derive from `profile` (must match `NavigationServer`). */
  effectiveRole?: UserRole
}

/**
 * Anonymous bar, onboarding bar and mobile nav. Authenticated desktop nav is the
 * workspace chrome in `NavigationServer`.
 */
function NavigationContent({
  user,
  profile,
  initialLatestSeason = '81',
  guildThemeData,
  hasCluster = false,
  hideAnalytics = false,
  userAccessLevels,
  featureReleaseStages = {},
  effectiveRole
}: NavigationProps) {
  const searchParams = useSearchParams()
  const latestSeason = initialLatestSeason
  const currentSeason = searchParams.get('season') || latestSeason
  const resolvedRole: UserRole =
    effectiveRole ?? ((profile?.role ?? 'member') as UserRole)

  const handleLogout = async () => {
    await fetch('/api/auth/signout', {
      method: 'POST',
      redirect: 'manual'
    })
    window.location.replace('/')
  }

  if (resolvedRole === 'onboarding') {
    return <OnboardingNav onLogout={handleLogout} />
  }

  if (!user) {
    return <PublicNav guildThemeData={guildThemeData} />
  }

  return (
    <MobileNav
      user={user}
      profile={profile ?? null}
      effectiveRole={resolvedRole}
      guildThemeData={guildThemeData}
      currentSeason={currentSeason}
      hasCluster={hasCluster}
      hideAnalytics={hideAnalytics}
      hasProfile={!!profile}
      onLogout={handleLogout}
      userAccessLevels={userAccessLevels}
      featureReleaseStages={featureReleaseStages}
    />
  )
}

export default function Navigation({
  user,
  profile,
  initialLatestSeason,
  guildThemeData,
  hasCluster,
  hideAnalytics,
  userAccessLevels,
  featureReleaseStages,
  effectiveRole
}: NavigationProps) {
  return (
    <Suspense fallback={<div className="h-16" aria-hidden="true" />}>
      <NavigationContent
        user={user}
        profile={profile}
        initialLatestSeason={initialLatestSeason}
        guildThemeData={guildThemeData}
        hasCluster={hasCluster}
        hideAnalytics={hideAnalytics}
        userAccessLevels={userAccessLevels}
        featureReleaseStages={featureReleaseStages}
        effectiveRole={effectiveRole}
      />
    </Suspense>
  )
}
