import {
  Users,
  Target,
  Shield,
  Sword,
  Castle,
  Warehouse,
  Plane,
  Radio,
  Ambulance,
  Factory,
  Crosshair
} from 'lucide-react'

export type ZoneRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface WarZoneConfig {
  zoneId: string
  zoneName: string
  visualId: string
  row: number
  column: number
  score: number
  canBeMoved: boolean
  buffId?: string
  difficulty: 'frontline' | 'support' | 'strategic' | 'command'
  baseRarity: ZoneRarity
  rarityByBattlefield: Record<number, ZoneRarity>
  recommendedPower: number
}

export interface GuildMember {
  user_id: string
  display_name: string
  role: string
  power?: number
  battles?: number
  player_level?: number
  avatar_unit_id?: string
}

export type BattlefieldLevel = 1 | 2 | 3 | 4 | 5

export const BATTLEFIELD_MULTIPLIERS: Record<BattlefieldLevel, number> = {
  1: 0.5,
  2: 0.75,
  3: 1.0,
  4: 1.25,
  5: 1.5
}

export const RARITY_COLORS: Record<
  ZoneRarity,
  { bg: string; text: string; border: string; gradient: string }
> = {
  common: {
    bg: 'bg-gray-500/20',
    text: 'text-gray-300',
    border: 'border-gray-500/30',
    gradient: 'from-gray-900/40 to-gray-950/60'
  },
  uncommon: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    gradient: 'from-green-900/40 to-green-950/60'
  },
  rare: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    gradient: 'from-blue-900/40 to-blue-950/60'
  },
  epic: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    gradient: 'from-purple-900/40 to-purple-950/60'
  },
  legendary: {
    bg: 'bg-orange-500/20',
    text: 'text-orange-400',
    border: 'border-orange-500/30',
    gradient: 'from-orange-900/40 to-orange-950/60'
  }
}

export const RARITY_LABELS: Record<ZoneRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary'
}

export const BATTLEFIELD_LABELS: Record<BattlefieldLevel, string> = {
  1: 'BF1 (Beginner)',
  2: 'BF2 (Easy)',
  3: 'BF3 (Normal)',
  4: 'BF4 (Hard)',
  5: 'BF5 (Expert)'
}

export const getRarityColor = (rarity: ZoneRarity): string => {
  const colors = RARITY_COLORS[rarity]
  return `${colors.bg} ${colors.text} ${colors.border}`
}

export const getZoneIcon = (visualId: string, size: 'sm' | 'lg' = 'sm') => {
  const className = size === 'lg' ? 'h-8 w-8' : 'h-4 w-4'
  switch (visualId) {
    case 'trenches':
      return <Sword className={className} />
    case 'hq':
      return <Castle className={className} />
    case 'artilleryPosition':
      return <Crosshair className={className} />
    case 'antiAirBattery':
      return <Radio className={className} />
    case 'barracks':
      return <Users className={className} />
    case 'bunker':
      return <Shield className={className} />
    case 'armory':
      return <Factory className={className} />
    case 'supplyDump':
      return <Warehouse className={className} />
    case 'fieldHospital':
      return <Ambulance className={className} />
    case 'landingPad':
      return <Plane className={className} />
    default:
      return <Target className={className} />
  }
}

export const getZoneGradient = (rarity: ZoneRarity): string => {
  return RARITY_COLORS[rarity].gradient
}

export const formatPower = (power: number): string => {
  if (power >= 1000000000) return `${(power / 1000000000).toFixed(1)}B`
  if (power >= 1000000) return `${(power / 1000000).toFixed(1)}M`
  if (power >= 1000) return `${(power / 1000).toFixed(0)}K`
  return power.toString()
}
