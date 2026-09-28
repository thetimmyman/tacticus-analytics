'use client'

import { Sparkles, Beaker, Zap, Clock } from 'lucide-react'
import type { ReleaseStage } from '@/app/lib/utils/release-stage'

export type { ReleaseStage } from '@/app/lib/utils/release-stage'

interface ReleaseStageBadgeProps {
  stage: ReleaseStage
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
}

const stageConfig: Record<
  ReleaseStage,
  {
    gradient: string
    textColor: string
    label: string
    icon: typeof Sparkles
  }
> = {
  alpha: {
    gradient: 'bg-linear-to-r from-red-500 to-red-600',
    textColor: 'text-white',
    label: 'Alpha',
    icon: Beaker
  },
  beta: {
    gradient: 'bg-linear-to-r from-blue-500 to-blue-600',
    textColor: 'text-white',
    label: 'Beta',
    icon: Zap
  },
  coming_soon: {
    gradient: 'bg-linear-to-r from-gray-500 to-gray-600',
    textColor: 'text-white',
    label: 'Planned',
    icon: Clock
  },
  public: {
    gradient: 'bg-linear-to-r from-green-500 to-green-600',
    textColor: 'text-white',
    label: 'Public',
    icon: Sparkles
  }
}

export function ReleaseStageBadge({
  stage,
  size = 'sm',
  showIcon = true
}: ReleaseStageBadgeProps) {
  const config = stageConfig[stage]
  const Icon = config.icon

  const sizeClasses = {
    sm: 'text-[9px] px-1 py-px gap-0.5',
    md: 'text-[10px] px-1.5 py-0.5 gap-0.5',
    lg: 'text-xs px-2 py-1 gap-1'
  }

  const iconSizes = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3'
  }

  if (stage === 'public') {
    return null
  }

  return (
    <span
      className={`
      inline-flex items-center rounded-full font-semibold shadow-xs
      ${sizeClasses[size]}
      ${config.gradient}
      ${config.textColor}
    `}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {config.label}
    </span>
  )
}
