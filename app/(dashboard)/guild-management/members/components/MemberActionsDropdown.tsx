'use client'

import Link from 'next/link'
import { Button } from '@tacticus/ui-kit'
import {
  RadixDropdownMenu,
  RadixDropdownMenuTrigger,
  RadixDropdownMenuContent,
  RadixDropdownMenuItem,
  RadixDropdownMenuSeparator,
  RadixDropdownMenuLabel
} from '@tacticus/ui-kit/radix-dropdown'
import type { ExtendedMember, MemberActionType } from './types'

interface MemberActionsDropdownProps {
  member: ExtendedMember
  onAction: (action: MemberActionType) => void
  size?: 'sm' | 'default'
  isAppAdmin?: boolean
}

export function MemberActionsDropdown({
  member,
  onAction,
  size = 'default',
  isAppAdmin = false
}: MemberActionsDropdownProps) {
  const isUnclaimed = !member.user_id

  return (
    <RadixDropdownMenu>
      <RadixDropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={size === 'sm' ? 'px-3 py-1 text-xs' : 'rounded-full px-4'}
        >
          Manage
        </Button>
      </RadixDropdownMenuTrigger>
      <RadixDropdownMenuContent
        align="end"
        className={size === 'sm' ? 'w-56' : 'w-64'}
      >
        <RadixDropdownMenuLabel className={size === 'sm' ? 'text-xs' : ''}>
          Member Actions
        </RadixDropdownMenuLabel>
        <RadixDropdownMenuSeparator />
        {isUnclaimed && (
          <>
            <RadixDropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                onAction('generateInviteCode')
              }}
              className={`${size === 'sm' ? 'text-xs' : ''} text-emerald-400`}
            >
              Generate Invite Code
            </RadixDropdownMenuItem>
            <RadixDropdownMenuSeparator />
          </>
        )}
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('apiKey')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Insert Player API Key
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('assignBosses')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Assign Bosses
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('notes')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Edit Notes
        </RadixDropdownMenuItem>
        <RadixDropdownMenuSeparator />
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('bossPreferences')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Edit Boss Preferences
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('metaTeams')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Edit Meta Team Preferences
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('heraldRoles')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Edit Herald Roles
        </RadixDropdownMenuItem>
        <RadixDropdownMenuSeparator />
        <RadixDropdownMenuItem
          asChild
          className={size === 'sm' ? 'text-xs' : ''}
        >
          <Link href={`/roster/${encodeURIComponent(member.player_id)}`}>
            View Roster
          </Link>
        </RadixDropdownMenuItem>
        <RadixDropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onAction('discordHandle')
          }}
          className={size === 'sm' ? 'text-xs' : ''}
        >
          Set Discord Handle
        </RadixDropdownMenuItem>
        {isAppAdmin && (
          <>
            <RadixDropdownMenuSeparator />
            <RadixDropdownMenuLabel className={size === 'sm' ? 'text-xs' : ''}>
              Admin
            </RadixDropdownMenuLabel>
            <RadixDropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                if (isUnclaimed) return
                onAction('adminUnlink')
              }}
              disabled={isUnclaimed}
              className={`${size === 'sm' ? 'text-xs' : ''} ${isUnclaimed ? 'text-[var(--text-tertiary)]' : 'text-amber-400'}`}
              title={
                isUnclaimed
                  ? 'Already unclaimed — nothing to unlink'
                  : 'Clear the user_id on this player slot (admin-only, audited)'
              }
            >
              Unlink from User
            </RadixDropdownMenuItem>
          </>
        )}
      </RadixDropdownMenuContent>
    </RadixDropdownMenu>
  )
}
