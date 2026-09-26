import type { UserRole } from '@tacticus/app-core/types'
import type {
  FeatureReleaseStages,
  UserAccessLevels
} from '@/app/lib/services/feature-release-service'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { canAccessReleaseStage } from '@/app/lib/utils/release-stage'
import {
  getVisibleWorkspaceSections,
  isInactiveNavigationContext,
  workspaces,
  type Workspace
} from './workspaces'

export interface GuildThemeData {
  guild_code: string
  display_name: string
  primary_color: string
  secondary_color: string
  accent_color: string
  logo_url?: string
  theme_name: string
}

export interface AccountNavigationUser {
  id: string
  email?: string
}

export interface AccountNavigationProfile {
  user_id?: string | null
  role?: string | null
  guild_code?: string | null
  display_name?: string | null
  is_app_admin?: boolean | null
  avatar_url?: string | null
}

export interface AccountNavigationPolicyInput {
  effectiveRole: UserRole
  featureReleaseStages?: FeatureReleaseStages
  guildThemeData?: GuildThemeData | null
  hasCluster?: boolean
  hasProfile?: boolean
  hideAnalytics?: boolean
  profile: AccountNavigationProfile | null
  userAccessLevels?: UserAccessLevels | null
}

export interface AccountNavigationState {
  guildDisplayLabel: string
  inactiveNavigation: boolean
  visibleWorkspaces: Workspace[]
}

export function resolveAccountNavigationState({
  effectiveRole,
  featureReleaseStages = {},
  guildThemeData,
  hasCluster = false,
  hasProfile = true,
  hideAnalytics = false,
  profile,
  userAccessLevels
}: AccountNavigationPolicyInput): AccountNavigationState {
  const inactiveNavigation = isInactiveNavigationContext({
    hideAnalytics,
    hasProfile
  })
  const guildDisplayLabel =
    profile?.guild_code || guildThemeData
      ? formatGuildDisplayLabel(guildThemeData, profile?.guild_code)
      : 'No Guild'
  const isAppAdmin = profile?.is_app_admin ?? false
  const visibleWorkspaces = workspaces
    .map((workspace): Workspace => {
      const sections = getVisibleWorkspaceSections(workspace, {
        effectiveRole,
        hideAnalytics,
        hasProfile,
        isAppAdmin,
        includeAdminSection: true,
        hasCluster
      }).filter((section) => {
        const releaseStage =
          featureReleaseStages[section.href] || section.releaseStage
        return canAccessReleaseStage(releaseStage, userAccessLevels)
      })
      return { ...workspace, sections }
    })
    .filter((workspace) => workspace.sections.length > 0)

  return { guildDisplayLabel, inactiveNavigation, visibleWorkspaces }
}
