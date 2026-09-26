import type { UserRole } from '@tacticus/app-core/types'

// `app_role` has both `officer` and `Officer`; SQL compares lower(role), so
// normalize or a stored `Officer` falls through to guest permissions.
function normalizeRole(role: UserRole | null | undefined): string {
  return (role ?? '').toLowerCase()
}

export interface RolePermissions {
  canViewAllGuilds: boolean
  canViewGuildData: boolean
  canViewTokenUsage: boolean
  canViewBossPages: boolean
  canViewPlayerPerformance: boolean
  canViewPlayerSearch: boolean
  canViewVOTLW: boolean
  canAccessOnboarding: boolean

  canEditGuildSettings: boolean
  canManageMembers: boolean
  canPromoteToOfficer: boolean
  canPromoteToLeader: boolean
  canManageApiKeys: boolean

  canViewDebugPage: boolean
  canExportData: boolean
}

export function getRolePermissions(
  role: UserRole | null | undefined
): RolePermissions {
  if (!role) {
    return getGuestPermissions()
  }

  switch (normalizeRole(role)) {
    case 'onboarding':
      return getOnboardingPermissions()
    case 'member':
      return getMemberPermissions()
    case 'officer':
      return getOfficerPermissions()
    case 'leader':
      return getLeaderPermissions()
    default:
      return getGuestPermissions()
  }
}

function getGuestPermissions(): RolePermissions {
  return {
    canViewAllGuilds: false,
    canViewGuildData: false,
    canViewTokenUsage: false,
    canViewBossPages: false,
    canViewPlayerPerformance: false,
    canViewPlayerSearch: false,
    canViewVOTLW: false,
    canAccessOnboarding: false,
    canEditGuildSettings: false,
    canManageMembers: false,
    canPromoteToOfficer: false,
    canPromoteToLeader: false,
    canManageApiKeys: false,
    canViewDebugPage: false,
    canExportData: false
  }
}

function getOnboardingPermissions(): RolePermissions {
  return {
    canViewAllGuilds: false,
    canViewGuildData: false,
    canViewTokenUsage: false,
    canViewBossPages: false,
    canViewPlayerPerformance: false,
    canViewPlayerSearch: false,
    canViewVOTLW: false,
    canAccessOnboarding: true,
    canEditGuildSettings: false,
    canManageMembers: false,
    canPromoteToOfficer: false,
    canPromoteToLeader: false,
    canManageApiKeys: false,
    canViewDebugPage: false,
    canExportData: false
  }
}

function getMemberPermissions(): RolePermissions {
  return {
    canViewAllGuilds: false,
    canViewGuildData: true,
    canViewTokenUsage: false, // V3: Members cannot view token usage
    canViewBossPages: false, // V3: Members cannot view boss pages
    canViewPlayerPerformance: true,
    canViewPlayerSearch: true,
    canViewVOTLW: true,
    canAccessOnboarding: false,
    canEditGuildSettings: false,
    canManageMembers: false,
    canPromoteToOfficer: false,
    canPromoteToLeader: false,
    // Informational only: the real /api-keys gates are the proxy, the page's
    // requireRole and the write routes' guild-credential checks.
    canManageApiKeys: true,
    canViewDebugPage: false,
    canExportData: false
  }
}

function getOfficerPermissions(): RolePermissions {
  return {
    canViewAllGuilds: false,
    canViewGuildData: true,
    canViewTokenUsage: true, // Officers can view token usage
    canViewBossPages: true, // Officers can view boss pages
    canViewPlayerPerformance: true,
    canViewPlayerSearch: true,
    canViewVOTLW: true,
    canAccessOnboarding: false,
    canEditGuildSettings: true, // V3: Officers can EDIT guild settings
    canManageMembers: true, // V3: Officers can EDIT members
    canPromoteToOfficer: false, // Cannot promote to same or higher role
    canPromoteToLeader: false,
    canManageApiKeys: true, // See member comment — key validity is the gate
    canViewDebugPage: true,
    canExportData: true
  }
}

function getLeaderPermissions(): RolePermissions {
  return {
    canViewAllGuilds: true, // Leaders can view ALL guilds
    canViewGuildData: true,
    canViewTokenUsage: true,
    canViewBossPages: true,
    canViewPlayerPerformance: true,
    canViewPlayerSearch: true,
    canViewVOTLW: true,
    canAccessOnboarding: false,
    canEditGuildSettings: true,
    canManageMembers: true,
    canPromoteToOfficer: true,
    canPromoteToLeader: true,
    canManageApiKeys: true,
    canViewDebugPage: true,
    canExportData: true
  }
}

export function canAccessPage(
  role: UserRole | null | undefined,
  page: string
): boolean {
  const permissions = getRolePermissions(role)

  switch (page) {
    case '/token-usage':
      return permissions.canViewTokenUsage
    case '/boss':
    case '/boss-l1':
    case '/boss-l2':
    case '/boss-l3':
    case '/boss-l4':
    case '/boss-l5':
      return permissions.canViewBossPages
    case '/player-performance':
      return permissions.canViewPlayerPerformance
    case '/player-stats':
      return permissions.canViewPlayerSearch
    case '/votlw':
      return permissions.canViewVOTLW
    case '/debug':
      return permissions.canViewDebugPage
    case '/settings':
    case '/guild-settings':
      return permissions.canEditGuildSettings
    case '/members':
    case '/member-management':
      return permissions.canManageMembers
    case '/api-keys':
      return permissions.canManageApiKeys
    default:
      return true // Allow access to unlisted pages by default
  }
}

export function getRoleDisplayName(role: UserRole): string {
  switch (normalizeRole(role)) {
    case 'onboarding':
      return 'Onboarding'
    case 'member':
      return 'Member'
    case 'officer':
      return 'Officer'
    case 'leader':
      return 'Leader'
    default:
      return 'Unknown'
  }
}

export function getRoleBadgeColor(role: UserRole): string {
  switch (normalizeRole(role)) {
    case 'onboarding':
      return 'bg-purple-500'
    case 'member':
      return 'bg-gray-500'
    case 'officer':
      return 'bg-blue-500'
    case 'leader':
      return 'bg-amber-500'
    default:
      return 'bg-gray-400'
  }
}
