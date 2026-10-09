'use client'

import Link from 'next/link'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { usePathname, useSearchParams } from 'next/navigation'
import type { UserRole } from '@tacticus/app-core/types'
import type {
  UserAccessLevels,
  FeatureReleaseStages
} from '@/app/lib/services/feature-release-service'
import {
  canAccessReleaseStage,
  type ReleaseStage
} from '@/app/lib/utils/release-stage'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import { cn } from '@/app/lib/utils/cn'
import {
  getVisibleWorkspaceSections,
  getWorkspaceEntryHref,
  resolveActiveWorkspace,
  type WorkspaceId,
  type WorkspaceSection,
  workspaces
} from './workspaces'
import { WAR_GLOBAL_SEGMENTS } from './config'

interface SectionSubnavProps {
  /** Overrides the pathname-resolved workspace (hover-preview, or a mis-classified page). */
  workspaceId?: WorkspaceId
  effectiveRole?: UserRole
  isAppAdmin?: boolean
  hasCluster?: boolean
  /** Inactive sessions must not see raid/war pills; same flags as WorkspaceBar. */
  hideAnalytics?: boolean
  hasProfile?: boolean
  userAccessLevels?: UserAccessLevels | null
  featureReleaseStages?: FeatureReleaseStages
  className?: string
  onPreviewKeep?: () => void
  onPreviewClear?: () => void
}

function isSectionVisible(
  section: WorkspaceSection,
  effectiveRole: UserRole | undefined
): boolean {
  if (!section.roles || section.roles.length === 0) return true
  if (!effectiveRole) return false
  if (effectiveRole === 'onboarding') return false
  return (section.roles as string[]).includes(effectiveRole)
}

function isSectionActive(pathname: string, section: WorkspaceSection): boolean {
  const matchPath = section.activePrefix ?? section.href
  // Exact match ('/wars' must not match '/wars/lineups') unless `activePrefix` opts in.
  if (!section.activePrefix) {
    if (pathname === matchPath) return true
    // Prefix match only at a path boundary ('/war' must not match '/war-tracking').
    return pathname.startsWith(`${matchPath}/`)
  }
  return pathname === matchPath || pathname.startsWith(`${matchPath}/`)
}

export function SectionSubnav({
  workspaceId,
  effectiveRole,
  isAppAdmin = false,
  hasCluster = false,
  hideAnalytics = false,
  hasProfile = true,
  userAccessLevels,
  featureReleaseStages = {},
  className,
  onPreviewKeep,
  onPreviewClear
}: SectionSubnavProps) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const currentSeason = searchParams.get('season')
  const prefetch = getRuntimeProfile() === 'desktop' ? false : undefined

  const workspace = workspaceId
    ? (workspaces.find((w) => w.id === workspaceId) ??
      resolveActiveWorkspace(pathname))
    : resolveActiveWorkspace(pathname)

  // A per-war page has its own instance-scoped rail, so this row is demoted.
  const warPathSegment = pathname.match(/^\/wars\/([^/]+)/)?.[1]
  const isWarDetailContext =
    workspace.id === 'war' &&
    warPathSegment !== undefined &&
    !WAR_GLOBAL_SEGMENTS.has(warPathSegment)

  const visibleSections = getVisibleWorkspaceSections(workspace, {
    effectiveRole,
    isAppAdmin,
    hasCluster,
    hideAnalytics,
    hasProfile
  })
    .filter((s) => isSectionVisible(s, effectiveRole))
    // Hide unreachable (stage-gated) sections rather than show a locked pill.
    .filter((s) => {
      const stage = (featureReleaseStages[s.href] || s.releaseStage) as
        ReleaseStage | undefined
      return canAccessReleaseStage(stage, userAccessLevels)
    })

  if (visibleSections.length === 0) return null

  // On a war page the War pills would duplicate WarSubnav, so show one exit chip.
  if (isWarDetailContext) {
    // First visible war section; hardcoding /wars would bypass release-stage gating.
    const exitHref = getWorkspaceEntryHref(workspace, visibleSections)
    return (
      <nav
        aria-label={`${workspace.label} workspace`}
        onMouseEnter={onPreviewKeep}
        onMouseLeave={onPreviewClear}
        data-subnav-emphasis="secondary"
        className={cn(
          'hidden lg:block border-b border-(--card-border) backdrop-blur-xs bg-black/10',
          className
        )}
      >
        <div className="mx-auto max-w-[1440px] overflow-x-auto px-4 sm:px-6 lg:px-8">
          <ul className="flex items-center gap-2 min-w-max py-1.5">
            <li className="shrink-0">
              <Link
                href={getHrefWithSeason(exitHref, currentSeason)}
                prefetch={prefetch}
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-(--card-border) px-3.5 py-1.5 text-xs font-medium text-secondary-wh40k transition-colors hover:text-primary-wh40k hover:border-[color-mix(in_srgb,var(--text-secondary)_60%,transparent)]"
              >
                <span aria-hidden="true">◂</span>
                <span>All War Tools</span>
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label={`${workspace.label} sections`}
      onMouseEnter={onPreviewKeep}
      onMouseLeave={onPreviewClear}
      data-subnav-emphasis="primary"
      className={cn(
        // Hidden below lg like WorkspaceBar; MobileNav covers mobile.
        'hidden lg:block border-b border-(--card-border) backdrop-blur-xs bg-black/20',
        className
      )}
    >
      <div className="mx-auto max-w-[1440px] overflow-x-auto px-4 sm:px-6 lg:px-8">
        <ul className="flex items-center gap-2 min-w-max py-2.5">
          {visibleSections.map((section) => {
            const active = isSectionActive(pathname, section)

            const linkProps = section.external
              ? {
                  href: section.href,
                  target: '_blank',
                  rel: 'noopener noreferrer'
                }
              : {
                  href: getHrefWithSeason(section.href, currentSeason),
                  prefetch
                }

            const Component = section.external ? 'a' : Link

            return (
              <li key={section.href} className="shrink-0">
                <Component
                  {...linkProps}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--accent)'
                      : 'border-(--card-border) bg-(--card-bg) text-secondary-wh40k hover:border-(--card-border) hover:bg-(--card-bg) hover:text-primary-wh40k'
                  )}
                >
                  <span>{section.label}</span>
                  {section.external && (
                    <>
                      <span
                        className="text-[10px] text-secondary-wh40k"
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                      <span className="sr-only">(opens in new tab)</span>
                    </>
                  )}
                </Component>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
