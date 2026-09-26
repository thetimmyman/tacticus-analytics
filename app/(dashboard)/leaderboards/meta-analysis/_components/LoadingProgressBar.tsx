'use client'

import { Spinner } from '@tacticus/ui-kit'

export interface LoadingProgressBarProps {
  current: number
  total: number
}

export function LoadingProgressBar({
  current,
  total
}: LoadingProgressBarProps) {
  return (
    <div className="card-wh40k p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-6 h-6 border-2 border-[var(--card-border)] rounded-full"></div>
            <Spinner
              size="md"
              className="absolute left-0 top-0 text-cyan-400"
            />
          </div>
          <div className="text-[var(--accent)] font-medium">
            Loading Boss Analysis Data
          </div>
        </div>
        <div className="text-[var(--text-secondary)] text-sm">
          {current} / {total}
        </div>
      </div>

      <div className="w-full bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 ease-out relative"
          style={{
            width: `${total > 0 ? (current / total) * 100 : 0}%`
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse"></div>
        </div>
      </div>

      <div className="text-xs text-[var(--text-secondary)] mt-2 text-center">
        Analyzing team compositions across all boss levels...
      </div>
    </div>
  )
}
