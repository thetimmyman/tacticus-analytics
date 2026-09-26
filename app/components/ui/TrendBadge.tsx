'use client'

import { Minus, TrendingDown, TrendingUp } from 'lucide-react'

export type TrendDirection = 'improving' | 'declining' | 'stable'

const trendStyles = {
  improving: {
    Icon: TrendingUp,
    className: 'text-green-400'
  },
  declining: {
    Icon: TrendingDown,
    className: 'text-red-400'
  },
  stable: {
    Icon: Minus,
    className: 'text-yellow-400'
  }
} satisfies Record<
  TrendDirection,
  { Icon: typeof TrendingUp; className: string }
>

interface TrendBadgeProps {
  trend: TrendDirection
  showLabel?: boolean
  className?: string
}

export function TrendBadge({
  trend,
  showLabel = true,
  className = 'flex items-center justify-center gap-1'
}: TrendBadgeProps) {
  const { Icon, className: colorClassName } = trendStyles[trend]

  return (
    <div className={className}>
      <Icon className={`h-3 w-3 ${colorClassName}`} />
      {showLabel && (
        <span
          className={`text-[10px] uppercase font-semibold ${colorClassName}`}
        >
          {trend}
        </span>
      )}
    </div>
  )
}
