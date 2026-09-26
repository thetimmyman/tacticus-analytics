import type { ReleaseStage } from '@/app/lib/utils/release-stage'
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Map as MapIcon,
  Settings,
  Shield,
  Swords,
  Trophy,
  Wrench,
  XCircle,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  roles?: string[]
  releaseStage?: ReleaseStage
  /** Prefix for active-state matching instead of href, e.g. so /defense highlights a link to /offense. */
  activePrefix?: string
}

export type WarSubnavMode =
  { kind: 'global' } | { kind: 'detail'; warId: string }

// Keep in sync with the 'war' workspace sections in workspaces.ts.
export const warGlobalLinks: NavItem[] = [
  { href: '/wars', label: 'War Reports', icon: Swords },
  { href: '/war-room', label: 'War Room', icon: Shield },
  { href: '/wars/metrics', label: 'Guild Metrics', icon: BarChart3 },
  {
    href: '/wars/lineups/offense',
    label: 'Lineups',
    icon: ClipboardList,
    activePrefix: '/wars/lineups'
  },
  { href: '/wars/maps', label: 'Maps', icon: MapIcon },
  {
    href: '/wars/cores/offense',
    label: 'Cores',
    icon: Wrench,
    activePrefix: '/wars/cores'
  },
  { href: '/wars/analyze/team', label: 'Team Analysis', icon: BarChart3 },
  { href: '/wars/config', label: 'Config', icon: Settings }
]

export const WAR_GLOBAL_SEGMENTS = new Set(
  warGlobalLinks
    .map((link) => {
      const match = link.href.match(/^\/wars\/([^/]+)/)
      return match?.[1] ?? null
    })
    .filter((s): s is string => s !== null)
    .concat(['performance'])
)

export interface WarDetailTab {
  label: string
  icon: LucideIcon
  suffix: string
}

// The zone grid lives on /board; old 'Zones' and 'War Map' routes redirect there.
export const warDetailTabs: WarDetailTab[] = [
  { label: 'Overview', icon: BarChart3, suffix: '' },
  { label: 'War Board', icon: Trophy, suffix: '/board' },
  { label: 'Guild', icon: Shield, suffix: '/guild' },
  { label: 'Opponent', icon: Swords, suffix: '/opponent' },
  { label: 'Recent', icon: Clock3, suffix: '/recent' },
  { label: 'Perfect', icon: CheckCircle2, suffix: '/perfect' },
  { label: 'Failed', icon: XCircle, suffix: '/failed' }
]

export const DISCORD_INVITE_URL = 'https://discord.gg/vd9Htx6Xs4'
