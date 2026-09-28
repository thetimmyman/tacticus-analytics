// Text-fallback colours, keyed by camelCase and display names.
const FACTION_COLORS: Record<string, string> = {
  Ultramarines: 'text-blue-400',
  BlackLegion: 'text-primary-wh40k',
  Orks: 'text-green-500',
  AstraMilitarum: 'text-yellow-600',
  Necrons: 'text-emerald-400',
  DeathGuard: 'text-lime-500',
  Sisterhood: 'text-red-400',
  BlackTemplars: 'text-primary-wh40k',
  DarkAngels: 'text-green-600',
  SpaceWolves: 'text-sky-400',
  WorldEaters: 'text-red-600',
  ThousandSons: 'text-blue-300',
  Tyranids: 'text-purple-500',
  Tau: 'text-cyan-400',
  Aeldari: 'text-red-300',
  LeaguesOfVotann: 'text-orange-400',
  AdeptusMechanicus: 'text-red-500',
  BloodAngels: 'text-red-500',
  Genestealers: 'text-purple-400',
  Custodes: 'text-yellow-500',
  EmperorsChildren: 'text-pink-400',
  'Black Legion': 'text-primary-wh40k',
  'Astra Militarum': 'text-yellow-600',
  'Death Guard': 'text-lime-500',
  'Adepta Sororitas': 'text-red-400',
  'Black Templars': 'text-primary-wh40k',
  'Dark Angels': 'text-green-600',
  'Space Wolves': 'text-sky-400',
  'World Eaters': 'text-red-600',
  'Thousand Sons': 'text-blue-300',
  "T'au Empire": 'text-cyan-400',
  'Leagues of Votann': 'text-orange-400',
  'Adeptus Mechanicus': 'text-red-500',
  'Blood Angels': 'text-red-500',
  "Emperor's Children": 'text-pink-400'
}

interface FactionIconProps {
  faction: string
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

const BADGE_SIZE_MAP = {
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-12 w-12 text-xs',
  lg: 'h-16 w-16 text-sm'
} as const

const TEXT_SIZE_MAP = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base'
} as const

export function FactionIcon({
  faction,
  size = 'md',
  showLabel = false,
  className = ''
}: FactionIconProps) {
  const textSize = TEXT_SIZE_MAP[size]
  const colorClass = FACTION_COLORS[faction] || 'text-secondary-wh40k'
  const abbreviation =
    faction
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .map((word) => word[0])
      .filter(Boolean)
      .join('')
      .slice(0, 3)
      .toUpperCase() || '?'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        role="img"
        aria-label={faction}
        title={faction}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-current/40 font-bold ${BADGE_SIZE_MAP[size]} ${colorClass}`}
      >
        {abbreviation}
      </span>
      {showLabel && (
        <span className={`${colorClass} ${textSize} font-medium`}>
          {faction}
        </span>
      )}
    </span>
  )
}

export function getFactionIconUrl(_faction: string): null {
  return null
}

export function getFactionColor(faction: string): string {
  return FACTION_COLORS[faction] || 'text-secondary-wh40k'
}
