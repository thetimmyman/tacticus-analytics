import type { ReleaseStage } from '@/app/lib/utils/release-stage'
import type { UserRole } from '@tacticus/app-core/types'
import { isAlphaDeploymentEnvironment } from '@/app/lib/utils/deployment-environment'
import type { LucideIcon } from 'lucide-react'
import {
  Hammer,
  Home,
  Map as MapIcon,
  Settings,
  Shield,
  Swords,
  Users,
  Wrench
} from 'lucide-react'

/**
 * Unified workspace IA: each workspace owns section routes and `match` prefixes.
 * Single source for `WorkspaceBar` and `SectionSubnav`.
 */

export type WorkspaceId =
  | 'command'
  | 'raid'
  | 'guild-ops'
  | 'war'
  | 'tools'
  | 'community'
  | 'settings'
  | 'admin'

export interface WorkspaceSection {
  href: string
  label: string
  /** Same semantics as `releaseStage` in `config.ts`. */
  releaseStage?: ReleaseStage
  /** Active-state prefix (default `href`) so sibling children light the same pill. */
  activePrefix?: string
  /** Role gate; empty = all authenticated users. */
  roles?: Array<'member' | 'officer' | 'leader'>
  /** Requires a `cluster_code`; with `roles` it means "leader within a cluster". */
  requiresCluster?: boolean
  external?: boolean
  deployment?: 'alpha'
  /** Hidden unless `isAppAdmin`; parks admin-only beta features. */
  appAdminOnly?: boolean
}

export interface Workspace {
  id: WorkspaceId
  label: string
  icon: LucideIcon
  /**
   * Preferred entry route. Pass role-filtered, non-empty `visibleSections` to
   * `getWorkspaceEntryHref()`; its unfiltered default can link hidden sections.
   */
  primaryHref: string
  /** First match wins; order matters. */
  match: string[]
  sections: WorkspaceSection[]
}

export const workspaces: Workspace[] = [
  {
    id: 'command',
    label: 'Command',
    icon: Home,
    primaryHref: '/home',
    // /profile lives in Settings; /token-usage lives in Guild Ops.
    match: ['/home', '/explore', '/roster', '/achievements'],
    sections: [
      { href: '/home', label: 'Home' },
      { href: '/roster', label: 'Roster' },
      { href: '/achievements', label: 'Achievements' },
      { href: '/explore', label: 'Explore' }
    ]
  },
  {
    id: 'raid',
    label: 'Raid',
    icon: Swords,
    primaryHref: '/dashboard',
    match: [
      '/dashboard',
      '/boss',
      '/boss-playbooks',
      '/replays',
      '/leaderboards',
      '/player-stats',
      '/votlw',
      '/meta-atlas'
    ],
    sections: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/boss', label: 'Bosses' },
      { href: '/boss-playbooks', label: 'Playbooks', releaseStage: 'public' },
      // Login-gated only; RLS enforces per-row visibility.
      { href: '/replays', label: 'Replays' },
      { href: '/leaderboards', label: 'Leaderboards' },
      { href: '/player-stats', label: 'Your Stats' },
      { href: '/votlw', label: 'Awards' },
      { href: '/meta-atlas', label: 'Meta Atlas', releaseStage: 'public' }
    ]
  },
  {
    id: 'guild-ops',
    label: 'Guild Ops',
    icon: Shield,
    primaryHref: '/player-performance',
    match: [
      '/guild-management',
      '/guild-teams',
      '/guild-trends',
      '/player-performance',
      '/token-usage',
      '/guild-ops',
      '/boss-assignments'
    ],
    sections: [
      {
        href: '/player-performance',
        label: 'Performance',
        roles: ['officer', 'leader']
      },
      {
        href: '/guild-ops/player-lookup',
        label: 'Player Lookup',
        roles: ['officer', 'leader']
      },
      {
        href: '/guild-management/members',
        label: 'Members',
        activePrefix: '/guild-management/members',
        roles: ['officer', 'leader']
      },
      // Guild settings appear only under Settings; Guild Ops keeps `/guild-management`
      // in `match` so deep links resolve without lighting a Settings tab.
      {
        href: '/guild-teams',
        label: 'Guild Meta Tracker',
        roles: ['officer', 'leader']
      },
      // Must match the page gate (requireRole('officer')) or members bounce off /unauthorized.
      { href: '/token-usage', label: 'Tokens', roles: ['officer', 'leader'] },
      { href: '/guild-trends', label: 'Trends' },
      {
        href: '/guild-ops/cluster-analytics',
        label: 'Cluster Analytics',
        roles: ['leader'],
        requiresCluster: true
      },
      {
        href: '/guild-ops/cluster-management',
        label: 'Cluster Management',
        roles: ['leader'],
        requiresCluster: true
      },
      // Appended so /player-performance stays the default landing; edits stay behind `canEdit`.
      {
        href: '/boss-assignments',
        label: 'Boss Assignments',
        roles: ['member', 'officer', 'leader'],
        releaseStage: 'public'
      }
    ]
  },
  {
    id: 'war',
    label: 'War',
    icon: MapIcon,
    primaryHref: '/wars',
    match: ['/wars', '/war-room', '/war-explorer'],
    sections: [
      { href: '/wars', label: 'War Reports' },
      { href: '/war-room', label: 'War Room' },
      { href: '/wars/metrics', label: 'Guild Metrics' },
      {
        href: '/wars/lineups/offense',
        label: 'Lineups',
        activePrefix: '/wars/lineups'
      },
      { href: '/wars/maps', label: 'Maps' },
      {
        href: '/wars/cores/offense',
        label: 'Cores',
        activePrefix: '/wars/cores'
      },
      { href: '/wars/analyze/team', label: 'Team Analysis' },
      { href: '/wars/config', label: 'Config' }
    ]
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: Wrench,
    primaryHref: 'https://tacticusplanner.app/',
    match: [],
    sections: [
      {
        href: 'https://tacticusplanner.app/',
        label: 'Planner',
        external: true
      },
      {
        href: 'https://github.com/sigubrat/Homina',
        label: 'Homina',
        external: true
      },
      {
        href: 'https://www.tacticustable.com/',
        label: 'TacticusTable',
        external: true
      },
      {
        href: 'https://tacticus.wiki.gg/',
        label: 'Wiki',
        external: true
      },
      {
        href: 'https://www.tacticuscodex.com/',
        label: 'Codex',
        external: true
      },
      {
        href: 'https://tacticusdb.com/',
        label: 'Tacticus DB',
        external: true
      },
      {
        href: 'https://ahriman.app',
        label: 'Ahriman',
        external: true
      },
      {
        href: 'https://tacticus-raidman.com',
        label: 'Raidman Replays',
        external: true
      },
      {
        href: 'https://tacticussim.com/',
        label: 'Simulator',
        external: true
      },
      {
        href: 'https://terminusmaximus.com',
        label: 'Terminus Maximus',
        external: true
      }
    ]
  },
  {
    id: 'community',
    label: 'Community',
    icon: Users,
    primaryHref: '/creators',
    match: ['/creators', '/support-creator', '/acknowledgements'],
    sections: [
      { href: '/creators', label: 'Creators' },
      { href: '/support-creator', label: 'Support' },
      { href: '/acknowledgements', label: 'Thanks' },
      {
        href: 'https://discord.gg/vd9Htx6Xs4',
        label: 'Discord',
        external: true
      }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    primaryHref: '/profile',
    match: ['/profile', '/api-keys', '/guild-settings'],
    sections: [
      { href: '/profile', label: 'Profile' },
      // Makes `/guild-management/settings` reachable without Guild Ops; its ONLY nav entry.
      {
        href: '/guild-settings',
        label: 'Guild Settings',
        roles: ['officer', 'leader']
      },
      // The member's own key (a /profile card); the Profile pill stays lit.
      { href: '/profile#api-key', label: 'My API Key' },
      // The guild's shared key, visible to every rank: any member may write (Remove stays
      // officer+) so a mis-synced officer can fix it; roles exclude `onboarding`. Nav, page,
      // proxy and write routes must agree (api-key-surface-gates.test.ts).
      {
        href: '/api-keys',
        label: 'Guild API Key',
        roles: ['member', 'officer', 'leader']
      }
    ]
  },
  {
    // Every section is appAdminOnly, so non-admins never see the pill.
    id: 'admin',
    label: 'Admin',
    icon: Hammer,
    primaryHref: '/admin/feature-releases',
    match: ['/admin'],
    sections: [
      {
        href: '/admin/feature-releases',
        label: 'Feature Releases',
        appAdminOnly: true
      }
    ]
  }
]

export interface WorkspaceVisibilityOptions {
  effectiveRole?: UserRole
  hideAnalytics?: boolean
  hasProfile?: boolean
  isAppAdmin?: boolean
  includeAdminSection?: boolean
  isAlphaDeployment?: boolean
  hasCluster?: boolean
}

/**
 * Inactive accounts get a recovery shell; only the exact hideAnalytics/hasProfile
 * pair from the inactive layout identifies that state.
 */
export function isInactiveNavigationContext({
  hideAnalytics = false,
  hasProfile = true
}: Pick<WorkspaceVisibilityOptions, 'hideAnalytics' | 'hasProfile'>): boolean {
  return hideAnalytics && !hasProfile
}

const INACTIVE_SAFE_SECTION_HREFS = new Set([
  '/home',
  '/explore',
  '/creators',
  '/support-creator',
  '/acknowledgements',
  'https://discord.gg/vd9Htx6Xs4'
])

export function getVisibleWorkspaceSections(
  workspace: Workspace,
  {
    effectiveRole,
    hideAnalytics = false,
    hasProfile = true,
    isAppAdmin = false,
    includeAdminSection: _includeAdminSection = false,
    isAlphaDeployment = isAlphaDeploymentEnvironment(),
    hasCluster = false
  }: WorkspaceVisibilityOptions
): WorkspaceSection[] {
  const inactiveNavigation = isInactiveNavigationContext({
    hideAnalytics,
    hasProfile
  })

  if (
    (workspace.id === 'raid' || workspace.id === 'war') &&
    (hideAnalytics || !hasProfile || effectiveRole === 'onboarding')
  ) {
    return []
  }

  const sections = workspace.sections.filter((section) => {
    if (inactiveNavigation && !INACTIVE_SAFE_SECTION_HREFS.has(section.href)) {
      return false
    }
    if (section.deployment === 'alpha' && !isAlphaDeployment) return false
    if (section.appAdminOnly && !isAppAdmin) return false
    if (section.requiresCluster && !hasCluster) return false
    if (!section.roles || section.roles.length === 0) return true
    if (!effectiveRole || effectiveRole === 'onboarding') return false
    return (section.roles as string[]).includes(effectiveRole)
  })

  return sections
}

export function getWorkspaceEntryHref(
  workspace: Workspace,
  visibleSections: WorkspaceSection[] = workspace.sections
): string {
  return visibleSections[0]?.href ?? workspace.primaryHref
}

/**
 * First `match` prefix wins, falling back to `command`; exact matches are checked
 * first so `/home` cannot steal `/home/X`.
 */
export function resolveActiveWorkspace(pathname: string): Workspace {
  const admin = workspaces.find((ws) => ws.id === 'admin')
  if (admin) {
    for (const prefix of admin.match) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return admin
      }
    }
  }

  for (const ws of workspaces) {
    if (ws.id === 'admin') continue
    for (const prefix of ws.match) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return ws
      }
    }
  }
  return (
    workspaces[0] ?? {
      id: 'command',
      label: 'Command',
      icon: Home,
      primaryHref: '/home',
      match: ['/home'],
      sections: [{ href: '/home', label: 'Home' }]
    }
  )
}
