'use client'

import { Skull, Zap, Sparkles } from 'lucide-react'
import { useBossEasterEgg } from './BossEasterEggProvider'

interface BossEasterEggToggleProps {
  variant?: 'full' | 'compact' | 'icon'
  className?: string
}

export function BossEasterEggToggle({
  variant = 'full',
  className = ''
}: BossEasterEggToggleProps) {
  const { isBossEasterEggEnabled, toggleBossEasterEgg } = useBossEasterEgg()

  if (variant === 'icon') {
    return (
      <button
        onClick={toggleBossEasterEgg}
        className={`p-2 rounded-lg transition-all ${
          isBossEasterEggEnabled
            ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 ring-2 ring-purple-500/50'
            : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)]'
        } ${className}`}
        title={
          isBossEasterEggEnabled
            ? 'Disable Boss Easter Eggs'
            : 'Enable Boss Easter Eggs'
        }
      >
        <Skull
          className={`h-5 w-5 ${isBossEasterEggEnabled ? 'animate-pulse' : ''}`}
        />
      </button>
    )
  }

  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          onClick={toggleBossEasterEgg}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            isBossEasterEggEnabled
              ? 'bg-gradient-to-r from-purple-500/20 to-red-500/20 text-purple-300 border border-purple-500/30'
              : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--card-border)]'
          }`}
        >
          {isBossEasterEggEnabled ? (
            <>
              <Skull className="h-4 w-4 text-purple-400" />
              <span>Easter Eggs On</span>
              <Zap className="h-4 w-4 text-yellow-400 animate-pulse" />
            </>
          ) : (
            <>
              <Skull className="h-4 w-4" />
              <span>Enable Easter Eggs</span>
            </>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className={`card-wh40k p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${isBossEasterEggEnabled ? 'bg-purple-500/20' : 'bg-[var(--card-bg)]'}`}
          >
            <Skull
              className={`h-6 w-6 ${isBossEasterEggEnabled ? 'text-purple-400 animate-pulse' : 'text-[var(--text-secondary)]'}`}
            />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">
              Boss Easter Eggs
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Warp-touched interventions from the bosses
            </p>
          </div>
        </div>
        <button
          onClick={toggleBossEasterEgg}
          className={`relative w-14 h-7 rounded-full transition-all ${
            isBossEasterEggEnabled
              ? 'bg-gradient-to-r from-purple-500 to-red-500'
              : 'bg-[var(--card-border)]'
          }`}
        >
          <div
            className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all ${
              isBossEasterEggEnabled ? 'left-8' : 'left-1'
            }`}
          >
            {isBossEasterEggEnabled && (
              <Skull className="absolute inset-0 m-auto h-3 w-3 text-purple-600" />
            )}
          </div>
        </button>
      </div>

      {isBossEasterEggEnabled && (
        <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--card-border)]">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span>
              Active! Bosses may intervene during your analysis sessions...
            </span>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] italic mt-2">
            Each boss has unique themed messages and visual glitch effects.
          </p>
        </div>
      )}

      {!isBossEasterEggEnabled && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)]">
          <Zap className="h-4 w-4 text-yellow-500" />
          <span>
            Enable to experience random boss interventions with glitch effects!
          </span>
        </div>
      )}
    </div>
  )
}
