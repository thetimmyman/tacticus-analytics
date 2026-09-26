'use client'

import { usePathname } from 'next/navigation'
import { Avatar } from '@tacticus/ui-kit'
import { MemberName } from '@/app/components/ui/MemberName'
import {
  RadixDropdownMenu,
  RadixDropdownMenuTrigger,
  RadixDropdownMenuContent,
  RadixDropdownMenuSeparator
} from '@tacticus/ui-kit/radix-dropdown'
import {
  resolveAccountNavigationState,
  type AccountNavigationPolicyInput,
  type AccountNavigationUser
} from './account-navigation'
import { WorkspaceSectionMenuLink } from './WorkspaceSectionMenuLink'
import { AccountMenuHeader, AccountMenuLogout } from './AccountMenuChrome'

interface UserMenuProps extends AccountNavigationPolicyInput {
  user: AccountNavigationUser
  currentSeason: string | null
  onLogout: () => void
}

export function UserMenu({
  user,
  profile,
  effectiveRole,
  guildThemeData,
  currentSeason,
  hasCluster = false,
  hideAnalytics = false,
  hasProfile = true,
  userAccessLevels,
  featureReleaseStages = {},
  onLogout
}: UserMenuProps) {
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

  return (
    <RadixDropdownMenu>
      <RadixDropdownMenuTrigger asChild>
        <button className="flex items-center space-x-3 p-2 rounded-lg hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] transition-colors relative">
          <div className="text-right hidden lg:block">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              <MemberName
                value={profile?.display_name || user.email}
                fallback="User"
              />
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {guildDisplayLabel}
            </div>
          </div>
          <div className="w-8 h-8 relative flex-shrink-0">
            <Avatar
              displayName={profile?.display_name || user.email || 'User'}
              guildCode={profile?.guild_code || 'DEFAULT'}
              size="sm"
              avatarUrl={profile?.avatar_url}
            />
          </div>
        </button>
      </RadixDropdownMenuTrigger>

      <RadixDropdownMenuContent
        align="end"
        sideOffset={4}
        className="w-80 max-h-[85vh] overflow-y-auto bg-[var(--dropdown-bg-solid)] border border-[var(--card-border)]"
      >
        <AccountMenuHeader
          currentSeason={currentSeason}
          effectiveRole={effectiveRole}
          guildDisplayLabel={guildDisplayLabel}
          inactiveNavigation={inactiveNavigation}
          profile={profile}
          user={user}
          variant="desktop"
        />

        <div className="p-3 space-y-3">
          {/* Account-scoped sections only; the full IA lives in the workspace nav. */}
          {filteredWorkspaces
            .filter((workspace) => workspace.id === 'settings')
            .map((workspace) => {
              const WorkspaceIcon = workspace.icon

              return (
                <div key={workspace.id}>
                  <p className="text-xs font-bold text-[var(--text-secondary)] mb-2 px-1 uppercase tracking-wide">
                    <WorkspaceIcon
                      className="mr-1 inline h-3.5 w-3.5 align-[-2px]"
                      aria-hidden="true"
                    />
                    {workspace.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {workspace.sections.map((section) => {
                      return (
                        <WorkspaceSectionMenuLink
                          key={section.href}
                          currentSeason={currentSeason}
                          pathname={pathname}
                          section={section}
                          variant="desktop"
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
        </div>

        <RadixDropdownMenuSeparator className="bg-[var(--card-border)]" />
        <AccountMenuLogout onLogout={onLogout} variant="desktop" />
      </RadixDropdownMenuContent>
    </RadixDropdownMenu>
  )
}
