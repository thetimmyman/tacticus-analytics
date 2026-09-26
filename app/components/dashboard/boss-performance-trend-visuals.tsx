'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { type TrendDirection } from './boss-performance-tooltips'

export const getTrendIcon = (trend: TrendDirection) => {
  const iconClass = 'h-4 w-4'
  switch (trend) {
    case 'improving':
      return <TrendingDown className={`${iconClass} text-green-400`} />
    case 'declining':
      return <TrendingUp className={`${iconClass} text-red-400`} />
    case 'stable':
      return <Minus className={`${iconClass} text-yellow-400`} />
  }
}

export const getProblemSeverityColor = (
  severity: 'low' | 'medium' | 'high'
) => {
  switch (severity) {
    case 'high':
      return 'border-l-red-500 bg-red-500/10'
    case 'medium':
      return 'border-l-yellow-500 bg-yellow-500/10'
    case 'low':
      return 'border-l-green-500 bg-green-500/10'
  }
}
