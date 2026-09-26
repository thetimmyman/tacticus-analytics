'use client'

// .tsx because ROLE_TABS holds JSX icons.

import { Beaker, Zap, Shield } from 'lucide-react'

export interface UserResult {
  id: number | null
  user_id: string | null
  player_id: string | null
  username: string | null
  display_name: string
  email: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
  is_app_admin: boolean
  is_alpha_tester: boolean
  is_beta_tester: boolean
  discord_user_id: string | null
  discord_username: string | null
  avatar_url: string | null
  source: string
}

export interface Guild {
  guild_code: string
  guild_name: string
  cluster_code: string | null
  member_count: number
  accounts_count: number
}

export interface UserGrant {
  user_id: string
  email: string
  display_name: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
  access_level: string
  granted_at: string
  expires_at: string | null
  notes: string | null
}

export interface AdminUser {
  user_id: string
  email: string
  display_name: string | null
  guild_code: string | null
  cluster_code: string | null
  role: string | null
  player_id: string | null
  is_app_admin: boolean
}

export type RoleType = 'alpha_tester' | 'beta_tester' | 'admin'
export type ViewTab =
  'search' | 'alpha' | 'beta' | 'admins' | 'bans' | 'invites'

export const ROLE_TABS = [
  {
    key: 'admins' as const,
    label: 'App Admins',
    roleType: 'admin' as RoleType,
    icon: <Shield className="h-4 w-4" />,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30'
  },
  {
    key: 'alpha' as const,
    label: 'Alpha Testers',
    roleType: 'alpha_tester' as RoleType,
    icon: <Beaker className="h-4 w-4" />,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30'
  },
  {
    key: 'beta' as const,
    label: 'Beta Testers',
    roleType: 'beta_tester' as RoleType,
    icon: <Zap className="h-4 w-4" />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30'
  }
]

export const GAME_ROLES = ['leader', 'officer', 'member']
