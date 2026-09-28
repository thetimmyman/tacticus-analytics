'use client'

import Link from 'next/link'
import { Avatar } from '@tacticus/ui-kit'
import { RadixDropdownMenuItem } from '@tacticus/ui-kit/radix-dropdown'
import { LogOut, Settings } from 'lucide-react'
import { MemberName } from '@/app/components/ui/MemberName'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import type {
  AccountNavigationProfile,
  AccountNavigationUser
} from './account-navigation'

interface AccountMenuHeaderProps {
  currentSeason: string | null
  effectiveRole?: string | null
  guildDisplayLabel: string
  inactiveNavigation: boolean
  profile?: AccountNavigationProfile | null
  user: AccountNavigationUser
  variant: 'desktop' | 'mobile'
}

export function AccountMenuHeader({
  currentSeason,
  effectiveRole,
  guildDisplayLabel,
  inactiveNavigation,
  profile,
  user,
  variant
}: AccountMenuHeaderProps) {
  const isMobile = variant === 'mobile'
  const profileLink = (
    <Link
      href={getHrefWithSeason('/profile', currentSeason)}
      className={
        isMobile
          ? 'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center rounded-md p-2 transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]'
          : 'flex flex-col items-center rounded-md p-2 transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]'
      }
    >
      <Settings
        className={isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'}
        aria-hidden="true"
      />
      <span
        className={`${isMobile ? 'text-[8px]' : 'text-[9px]'} text-secondary-wh40k`}
      >
        Profile
      </span>
    </Link>
  )

  return (
    <div className="border-b border-(--card-border) bg-linear-to-r from-[color-mix(in_srgb,var(--primary)_10%,transparent)] to-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-3">
      <div className="flex items-center justify-between">
        <div
          className={`flex items-center ${isMobile ? 'space-x-2' : 'space-x-3'}`}
        >
          <div className={isMobile ? 'h-8 w-8' : 'h-10 w-10'}>
            <Avatar
              displayName={profile?.display_name || user.email || 'User'}
              guildCode={profile?.guild_code || 'DEFAULT'}
              size={isMobile ? 'sm' : 'md'}
              avatarUrl={profile?.avatar_url}
            />
          </div>
          <div>
            <p
              className={`font-semibold text-primary-wh40k ${isMobile ? 'text-xs' : 'text-sm'}`}
            >
              <MemberName value={profile?.display_name || user.email} />
            </p>
            <p
              className={`${isMobile ? 'text-[10px]' : 'text-xs'} text-secondary-wh40k`}
            >
              {guildDisplayLabel} •{' '}
              {inactiveNavigation ? (
                'INACTIVE'
              ) : !isMobile && effectiveRole !== profile?.role ? (
                <span className="text-(--accent)">
                  {effectiveRole?.toUpperCase()} (temp)
                </span>
              ) : (
                profile?.role?.toUpperCase() || 'MEMBER'
              )}
            </p>
          </div>
        </div>
        {!inactiveNavigation &&
          (isMobile ? (
            <RadixDropdownMenuItem asChild>{profileLink}</RadixDropdownMenuItem>
          ) : (
            profileLink
          ))}
      </div>
    </div>
  )
}

interface AccountMenuLogoutProps {
  onLogout: () => void
  variant: 'desktop' | 'mobile'
}

export function AccountMenuLogout({
  onLogout,
  variant
}: AccountMenuLogoutProps) {
  const isMobile = variant === 'mobile'

  return (
    <div className={isMobile ? 'p-2' : 'p-3'}>
      <button
        type="button"
        onClick={onLogout}
        className={`flex w-full items-center justify-center space-x-2 rounded-md bg-red-500/10 px-3 text-red-400 transition-colors hover:bg-red-500/20 ${
          isMobile ? 'min-h-[44px] py-2.5' : 'py-2'
        }`}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-semibold`}>
          Logout
        </span>
      </button>
    </div>
  )
}
