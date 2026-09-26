'use client'

import { Cog, Zap } from 'lucide-react'
import type {
  BossEasterEggConfig,
  BossIntervention
} from '@/app/lib/config/boss-easter-eggs'

interface BossEasterEggMessageTheme {
  border: string
  bg: string
  title: string
  titleColor: string
  iconColor: string
}

interface BossEasterEggInterventionMessageProps {
  config: BossEasterEggConfig
  currentIntervention: BossIntervention
  theme: BossEasterEggMessageTheme
}

export function BossEasterEggInterventionMessage({
  config,
  currentIntervention,
  theme
}: BossEasterEggInterventionMessageProps) {
  const renderDisplayPattern = () => {
    return (
      <>
        {config.displayPattern.map((text, index) => (
          <span
            key={index}
            className="animate-pulse"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            {text}
          </span>
        ))}
      </>
    )
  }

  return (
    <div className="fixed z-50 top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md sm:w-auto">
      <div
        className={`bg-black/95 border-2 rounded-lg p-4 shadow-2xl backdrop-blur-sm animate-pulse
            ${theme.border} ${theme.bg}`}
      >
        <div className="flex items-center space-x-3">
          <div className="relative">
            <currentIntervention.icon
              className={`w-6 h-6 ${currentIntervention.color} animate-pulse`}
            />
            <Zap className="absolute inset-0 w-6 h-6 text-yellow-400 animate-ping" />
          </div>
          <div className="flex-1">
            <p className={`font-mono text-xs font-bold ${theme.titleColor}`}>
              {theme.title}
            </p>
            <p
              className={`font-mono text-xs mt-1 ${currentIntervention.color}`}
            >
              {currentIntervention.message}
            </p>
          </div>
          <Cog className={`w-4 h-4 ${theme.iconColor} animate-spin`} />
        </div>

        {/* Pattern display */}
        <div
          className={`mt-2 flex justify-center space-x-1 text-xs font-mono ${theme.titleColor} opacity-60`}
        >
          {renderDisplayPattern()}
        </div>
      </div>
    </div>
  )
}
