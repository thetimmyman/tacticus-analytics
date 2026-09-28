'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'
import { MemberName } from '@/app/components/ui/MemberName'
import { Avatar } from '@tacticus/ui-kit'
import SeasonSelector from '@/app/components/SeasonSelector'
import {
  RadixDropdownMenu,
  RadixDropdownMenuTrigger,
  RadixDropdownMenuContent,
  RadixDropdownMenuItem,
  RadixDropdownMenuSeparator
} from '@tacticus/ui-kit/radix-dropdown'
import { Menu } from 'lucide-react'
import {
  resolveAccountNavigationState,
  type AccountNavigationPolicyInput,
  type AccountNavigationUser
} from './account-navigation'
import { WorkspaceSectionMenuLink } from './WorkspaceSectionMenuLink'
import { AccountMenuHeader, AccountMenuLogout } from './AccountMenuChrome'

interface MobileNavProps extends AccountNavigationPolicyInput {
  user: AccountNavigationUser
  currentSeason: string
  onLogout: () => void
}

export function MobileNav({
  user,
  profile,
  effectiveRole,
  guildThemeData,
  currentSeason,
  hasCluster = false,
  hideAnalytics = false,
  hasProfile = true,
  onLogout,
  userAccessLevels,
  featureReleaseStages = {}
}: MobileNavProps) {
  const pathname = usePathname()
  const {
    guildDisplayLabel,
    inactiveNavigation,
    visibleWorkspaces: filteredWorkspaces
  } = resolveAccountNavigationState({
    effectiveRole,
    featureReleaseStages,
    guildThemeData,
    hasCluster,
    hasProfile,
    hideAnalytics,
    profile,
    userAccessLevels
  })

  // Reads workspaces.ts like the desktop nav, so every workspace page has a mobile entry.
  return (
    <nav
      className="lg:hidden bg-black/60 backdrop-blur-xs border-b border-(--card-border) sticky top-0 z-50"
      data-app-chrome
    >
      <div className="flex h-12 items-center justify-between gap-2 px-3">
        <Link href="/home" className="flex shrink-0 items-center">
          {guildThemeData?.logo_url ? (
            <img
              src={guildThemeData.logo_url}
              alt={guildThemeData.display_name}
              className="h-7 w-7 shrink-0"
            />
          ) : (
            <AnalyticsIcon className="h-7 w-7 shrink-0 text-(--primary)" />
          )}
          <span className="ml-1.5 text-sm font-bold font-mono text-(--primary)">
            Tacticus Analytics
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          {!inactiveNavigation && (
            <div
              data-testid="mobile-season-control"
              className="shrink-0 scale-75"
            >
              <SeasonSelector currentSeason={currentSeason} />
            </div>
          )}

          <RadixDropdownMenu>
            <RadixDropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Open account and navigation menu"
                className="flex min-h-[44px] min-w-[44px] max-w-56 items-center justify-center gap-1.5 overflow-hidden rounded-lg px-2 py-1 transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
              >
                <div className="hidden min-w-0 max-w-40 text-right sm:block">
                  <div
                    data-testid="mobile-account-player-label"
                    className="min-w-0 truncate text-[9px] leading-tight text-secondary-wh40k"
                  >
                    <MemberName value={profile?.display_name} fallback="User" />
                  </div>
                  <div
                    data-testid="mobile-account-guild-label"
                    className="min-w-0 truncate text-[9px] font-semibold leading-tight text-(--primary)"
                  >
                    {guildDisplayLabel === 'No Guild'
                      ? 'NO GUILD'
                      : guildDisplayLabel}
                  </div>
                </div>
                <div className="relative h-7 w-7 shrink-0">
                  <Avatar
                    displayName={profile?.display_name || user.email || 'User'}
                    guildCode={profile?.guild_code || 'DEFAULT'}
                    size="sm"
                    avatarUrl={profile?.avatar_url}
                  />
                </div>
                <Menu
                  className="h-4 w-4 shrink-0 text-secondary-wh40k"
                  aria-hidden="true"
                />
              </button>
            </RadixDropdownMenuTrigger>

            <RadixDropdownMenuContent
              align="end"
              sideOffset={4}
              className="w-64 max-h-[85vh] overflow-y-auto bg-(--dropdown-bg-solid) border border-(--card-border)"
            >
              <AccountMenuHeader
                currentSeason={currentSeason}
                guildDisplayLabel={guildDisplayLabel}
                inactiveNavigation={inactiveNavigation}
                profile={profile}
                user={user}
                variant="mobile"
              />

              <div className="p-2 space-y-2">
                {filteredWorkspaces.map((workspace) => {
                  const WorkspaceIcon = workspace.icon

                  return (
                    <div key={workspace.id}>
                      <p className="text-[10px] font-bold text-secondary-wh40k mb-1 px-2 uppercase tracking-wide mt-2">
                        <WorkspaceIcon
                          className="mr-1 inline h-3 w-3 align-[-2px]"
                          aria-hidden="true"
                        />
                        {workspace.label}
                      </p>
                      <div className="grid grid-cols-2 gap-1">
                        {workspace.sections.map((section) => {
                          return (
                            <RadixDropdownMenuItem key={section.href} asChild>
                              <WorkspaceSectionMenuLink
                                currentSeason={currentSeason}
                                pathname={pathname}
                                section={section}
                                variant="mobile"
                              />
                            </RadixDropdownMenuItem>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <RadixDropdownMenuSeparator className="bg-(--card-border)" />
              <AccountMenuLogout onLogout={onLogout} variant="mobile" />
            </RadixDropdownMenuContent>
          </RadixDropdownMenu>
        </div>
      </div>
    </nav>
  )
}
