'use client'

/**
 * Phone bottom bar. Carries the workspaces marked `mobileTab` in `workspaces.ts`,
 * in declaration order, capped at five. It reads the same visibility-filtered
 * workspace list as the top-bar menu, so tabs cannot reintroduce a workspace
 * hidden by that policy; everything without a slot stays in the menu.
 *
 * Labels are always shown — an icon alone does not carry a destination name.
 */

import { ChromeLink as Link } from './ChromeLink'
import { usePathname } from 'next/navigation'
import {
  getWorkspaceEntryHref,
  resolveActiveWorkspace,
  type Workspace
} from './workspaces'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'

const MAX_TABS = 5

export interface MobileTabBarProps {
  /** Visibility-filtered workspaces, as returned by `resolveAccountNavigationState`. */
  workspaces: Workspace[]
  /** Active season. Tab hrefs carry it, like the rest of the chrome nav. */
  currentSeason?: string | null
}

export function MobileTabBar({
  workspaces,
  currentSeason = null
}: MobileTabBarProps) {
  const pathname = usePathname()
  const tabs = workspaces
    .filter((workspace) => workspace.mobileTab)
    .slice(0, MAX_TABS)

  if (tabs.length === 0) return null

  const activeId = resolveActiveWorkspace(pathname)?.id

  return (
    <nav
      aria-label="Primary"
      data-app-chrome
      data-testid="mobile-tab-bar"
      className="safe-x safe-bottom lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-(--card-border) bg-(--dropdown-bg-solid)"
    >
      <ul className="flex items-stretch justify-around">
        {tabs.map((workspace) => {
          const WorkspaceIcon = workspace.icon
          const active = workspace.id === activeId

          return (
            <li key={workspace.id} className="min-w-0 flex-1">
              <Link
                href={getHrefWithSeason(
                  getWorkspaceEntryHref(workspace),
                  currentSeason
                )}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex min-h-[calc(var(--mobile-navigation-height)_-_1px)] flex-col items-center justify-center gap-0.5 px-0.5 py-1 hover:bg-(--hover-bg) active:bg-(--hover-bg)',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
                  'focus-visible:outline-(--primary)',
                  active ? 'text-(--primary)' : 'text-secondary-wh40k'
                ].join(' ')}
              >
                <WorkspaceIcon
                  className="h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
                <span className="w-full text-center text-xs leading-tight font-semibold break-words">
                  {workspace.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
