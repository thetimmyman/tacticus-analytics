import { Shield } from 'lucide-react'

const ALLIANCE_COLORS: Record<string, string> = {
  Imperial: 'text-green-400',
  Chaos: 'text-orange-500',
  Xenos: 'text-cyan-400'
}

interface AllianceIconProps {
  alliance: string
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

const SIZE_MAP = {
  sm: 32,
  md: 48,
  lg: 64
} as const

const TEXT_SIZE_MAP = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base'
} as const

export function AllianceIcon({
  alliance,
  size = 'md',
  showLabel = false,
  className = ''
}: AllianceIconProps) {
  const iconSize = SIZE_MAP[size]
  const textSize = TEXT_SIZE_MAP[size]
  const colorClass = ALLIANCE_COLORS[alliance] || 'text-gray-400'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Shield
        role="img"
        aria-label={alliance}
        className={`${colorClass} fill-current/20`}
        width={iconSize}
        height={iconSize}
      />
      {showLabel && (
        <span className={`${colorClass} ${textSize} font-medium`}>
          {alliance}
        </span>
      )}
    </span>
  )
}

export function getAllianceIconUrl(_alliance: string): null {
  return null
}

export function getAllianceColor(alliance: string): string {
  return ALLIANCE_COLORS[alliance] || 'text-gray-400'
}
