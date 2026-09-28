'use client'

import Link from 'next/link'
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
  workspaces,
  type WorkspaceId
} from './workspaces'

interface WorkspaceBarProps {
  effectiveRole: UserRole
  isAppAdmin?: boolean
  hideAnalytics?: boolean
  hasProfile?: boolean
  hasCluster?: boolean
  userAccessLevels?: UserAccessLevels | null
  featureReleaseStages?: FeatureReleaseStages
  className?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  onPreviewWorkspace?: (id: WorkspaceId) => void
  /** The parent debounces and clears the preview. */
  onClearPreviewWorkspace?: () => void
}

/** Workspace pills; the active one matches the pathname against `match` prefixes. */
export function WorkspaceBar({
  effectiveRole,
  isAppAdmin = false,
  hideAnalytics = false,
  hasProfile = false,
  hasCluster = false,
  userAccessLevels,
  featureReleaseStages = {},
  className,
  leading,
  trailing,
  onPreviewWorkspace,
  onClearPreviewWorkspace
}: WorkspaceBarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSeason = searchParams.get('season')

  const active = resolveActiveWorkspace(pathname ?? '/')

  return (
    <nav
      aria-label="Workspaces"
      className={cn(
        // AlphaChromeBar owns sticky positioning so both rows pin together.
        'hidden lg:block border-b border-(--card-border) bg-black/40 backdrop-blur-xs',
        className
      )}
    >
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 py-2">
          {leading && <div className="shrink-0">{leading}</div>}
          <ul className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
            {workspaces.map((ws) => {
              const visibleSections = getVisibleWorkspaceSections(ws, {
                effectiveRole,
                hasProfile,
                hideAnalytics,
                isAppAdmin,
                hasCluster
              }).filter((sec) => {
                // Hide workspaces whose sections are all stage-gated beyond the user's access.
                const stage = (featureReleaseStages[sec.href] ||
                  sec.releaseStage) as ReleaseStage | undefined
                return canAccessReleaseStage(stage, userAccessLevels)
              })

              if (visibleSections.length === 0) {
                return null
              }
              const isActive = ws.id === active.id
              const href = getHrefWithSeason(
                getWorkspaceEntryHref(ws, visibleSections),
                currentSeason
              )

              return (
                <li key={ws.id} className="shrink-0">
                  <Link
                    href={href}
                    aria-current={isActive ? 'page' : undefined}
                    onMouseEnter={() => onPreviewWorkspace?.(ws.id)}
                    onMouseLeave={onClearPreviewWorkspace}
                    onFocus={() => onPreviewWorkspace?.(ws.id)}
                    onBlur={onClearPreviewWorkspace}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.16em] transition-colors',
                      isActive
                        ? 'border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--accent)'
                        : 'border-transparent text-secondary-wh40k hover:border-(--card-border) hover:bg-(--card-bg) hover:text-primary-wh40k'
                    )}
                  >
                    <span>{ws.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {trailing && (
            <div className="shrink-0 flex items-center gap-2">{trailing}</div>
          )}
        </div>
      </div>
    </nav>
  )
}
