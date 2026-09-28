// No toLocale* calls here, so .ts loses no hydration lint coverage.

import { getRankIndexFromName } from '@/app/(dashboard)/roster/utils/roster-helpers'
import type { GuildTeamRosterEntry } from './types'

export interface HeroMappingInfo {
  id: number
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
  category: string | null
}

export interface PlayerTokenInfo {
  display_name: string
  tokens_available: number | null
  token_next_in_seconds: number | null
  bombs_available_live: number | null
  bombs_used: number | null
  bomb_next_in_seconds: number | null
}

export interface GuildTeamsClientProps {
  guildCode: string
  heroMappings: Record<string, HeroMappingInfo>
  pageTitle: string
}

export type SortField = 'name' | 'team_score' | 'hero'
export type SortDirection = 'asc' | 'desc'

export const MIN_STARS_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 3, label: '3\u2605+' },
  { value: 6, label: '6\u2605+' },
  { value: 9, label: '9\u2605+' },
  { value: 12, label: '12\u2605+' },
  { value: 16, label: '16\u2605+' }
]

export const MIN_RANK_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 3, label: 'Iron+' },
  { value: 6, label: 'Bronze+' },
  { value: 9, label: 'Silver+' },
  { value: 12, label: 'Gold+' },
  { value: 15, label: 'Diamond+' },
  { value: 18, label: 'Adamantium+' }
]

export const TIER_LABELS: Record<string, string> = {
  core: 'Core',
  secondary: 'Secondary',
  tertiary: 'Tertiary'
}

export const TIER_COLORS: Record<string, string> = {
  core: 'border-yellow-500/40',
  secondary: 'border-blue-500/30',
  tertiary: 'border-card-border/20'
}

export const TIER_BG: Record<string, string> = {
  core: 'bg-yellow-500/6',
  secondary: 'bg-blue-500/6',
  tertiary: ''
}

export const PAGE_TITLES = [
  'Tani\u2019s All Seeing Eye',
  'Tani\u2019s Meta Tracker',
  'Tani\u2019s Meta Team Guild List',
  'Tani\u2019s Super Duper Meta List Tracker',
  'Tani\u2019s Guild Raid Teams'
]

// Picked once on the server and passed down: a client-side pick differs between SSR and hydration.
export function pickPageTitle(random: () => number = Math.random): string {
  return (
    PAGE_TITLES[Math.floor(random() * PAGE_TITLES.length)] ?? 'Guild Raid Teams'
  )
}

/** Core heroes count full, secondary half, tertiary a third. */
export const TIER_WEIGHTS: Record<string, number> = {
  core: 1,
  secondary: 0.5,
  tertiary: 1 / 3
}

/** Matches the member-management UI. */
export const TOKEN_CAP = 3

/** "3h 12m" / "12m" / "45s", or null. */
export function formatCountdown(
  seconds: number | null | undefined
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${total}s`
}

/** Higher is better. */
export function heroScore(
  entry: GuildTeamRosterEntry | undefined | null
): number {
  if (!entry || entry.stars == null) return -1
  const prog = entry.progression_index ?? entry.stars ?? 0
  const rank = entry.rank_name ? getRankIndexFromName(entry.rank_name) : 0
  const activeAbility = entry.active_ability_level ?? 0
  const passiveAbility = entry.passive_ability_level ?? 0
  return prog * 1000 + rank * 40 + activeAbility + passiveAbility
}

export function weightedHeroScore(
  entry: GuildTeamRosterEntry | undefined | null,
  tier: string
): number {
  const raw = heroScore(entry)
  if (raw < 0) return raw
  return Math.round(raw * (TIER_WEIGHTS[tier] ?? 1))
}
