'use client'

import Link from 'next/link'
import { Suspense, useCallback, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { UserRole } from '@tacticus/app-core/types'
import type { PlayerMapping } from '@tacticus/app-core/types'
import type {
  UserAccessLevels,
  FeatureReleaseStages
} from '@/app/lib/services/feature-release-service'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'
import SeasonSelector from '@/app/components/SeasonSelector'
import { WorkspaceBar } from './WorkspaceBar'
import { SectionSubnav } from './SectionSubnav'
import { UserMenu } from './UserMenu'
import { DiscordNavButton } from './DiscordNavButton'
import { isInactiveNavigationContext, type WorkspaceId } from './workspaces'

// Hover-preview revert delay, so the cursor can move from a pill into the SectionSubnav row.
const HOVER_PREVIEW_REVERT_MS = 450

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

interface AlphaChromeBarProps {
  effectiveRole: UserRole
  isAppAdmin?: boolean
  hideAnalytics?: boolean
  hasProfile?: boolean
  userAccessLevels?: UserAccessLevels | null
  featureReleaseStages?: FeatureReleaseStages
  user?: { id: string; email?: string } | null
  profile?: NavigationProfile | PlayerMapping | null
  guildThemeData?: GuildThemeData | null
  hasCluster?: boolean
  initialLatestSeason?: string
}

/** Two-row workspace chrome (WorkspaceBar + SectionSubnav). "Alpha" is historical. */
function AlphaChromeBarContent(props: AlphaChromeBarProps) {
  const searchParams = useSearchParams()
  const currentSeason =
    searchParams.get('season') || props.initialLatestSeason || '81'
  const inactiveNavigation = isInactiveNavigationContext({
    hideAnalytics: props.hideAnalytics,
    hasProfile: props.hasProfile
  })

  const [previewWorkspaceId, setPreviewWorkspaceId] =
    useState<WorkspaceId | null>(null)
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRevertTimer = useCallback(() => {
    if (revertTimerRef.current) {
      clearTimeout(revertTimerRef.current)
      revertTimerRef.current = null
    }
  }, [])

  const handlePreviewWorkspace = useCallback(
    (id: WorkspaceId) => {
      clearRevertTimer()
      setPreviewWorkspaceId(id)
    },
    [clearRevertTimer]
  )

  const handlePreviewClear = useCallback(() => {
    clearRevertTimer()
    revertTimerRef.current = setTimeout(() => {
      setPreviewWorkspaceId(null)
      revertTimerRef.current = null
    }, HOVER_PREVIEW_REVERT_MS)
  }, [clearRevertTimer])

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/signout', {
      method: 'POST',
      redirect: 'manual'
    })
    window.location.replace('/')
  }, [])

  // Null `user` suppresses the brand chrome (defensive; anonymous users take another path).
  const leading = props.user ? (
    <Link
      href="/home"
      className="flex items-center gap-2"
      aria-label="Tacticus Analytics home"
    >
      {props.guildThemeData?.logo_url ? (
        <img
          src={props.guildThemeData.logo_url}
          alt={props.guildThemeData.display_name}
          className="w-7 h-7"
        />
      ) : (
        <AnalyticsIcon
          className="w-7 h-7 text-(--primary)"
          aria-hidden="true"
        />
      )}
      <span className="hidden xl:inline text-sm font-bold font-mono tracking-tight text-(--primary)">
        Tacticus Analytics
      </span>
    </Link>
  ) : null

  const trailing = props.user ? (
    <>
      {!inactiveNavigation && (
        <SeasonSelector currentSeason={currentSeason} compact />
      )}
      <DiscordNavButton />
      <UserMenu
        user={props.user}
        profile={props.profile ?? null}
        effectiveRole={props.effectiveRole}
        guildThemeData={props.guildThemeData}
        currentSeason={currentSeason}
        hasCluster={props.hasCluster ?? false}
        hideAnalytics={props.hideAnalytics ?? false}
        hasProfile={!!props.profile}
        userAccessLevels={props.userAccessLevels}
        featureReleaseStages={props.featureReleaseStages}
        onLogout={handleLogout}
      />
    </>
  ) : null

  return (
    <div className="sticky top-0 z-50" data-app-chrome>
      <WorkspaceBar
        effectiveRole={props.effectiveRole}
        isAppAdmin={props.isAppAdmin}
        hideAnalytics={props.hideAnalytics}
        hasProfile={props.hasProfile}
        hasCluster={props.hasCluster ?? false}
        userAccessLevels={props.userAccessLevels}
        featureReleaseStages={props.featureReleaseStages}
        leading={leading}
        trailing={trailing}
        onPreviewWorkspace={handlePreviewWorkspace}
        onClearPreviewWorkspace={handlePreviewClear}
      />
      <SectionSubnav
        workspaceId={previewWorkspaceId ?? undefined}
        effectiveRole={props.effectiveRole}
        isAppAdmin={props.isAppAdmin}
        hasCluster={props.hasCluster ?? false}
        hideAnalytics={props.hideAnalytics ?? false}
        hasProfile={props.hasProfile ?? true}
        userAccessLevels={props.userAccessLevels}
        featureReleaseStages={props.featureReleaseStages}
        onPreviewKeep={clearRevertTimer}
        onPreviewClear={handlePreviewClear}
      />
    </div>
  )
}

export function AlphaChromeBar(props: AlphaChromeBarProps) {
  return (
    <Suspense
      fallback={
        <div
          className="hidden lg:block border-b border-(--card-border) bg-black/40 backdrop-blur-xs"
          aria-hidden="true"
        >
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 h-12" />
        </div>
      }
    >
      <AlphaChromeBarContent {...props} />
    </Suspense>
  )
}
