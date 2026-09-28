'use client'

import { StatusMessageIcon } from '@/app/components/gr-availability/StatusMessageIcon'
import type {
  ExportStatusType,
  PlayerAvailability,
  StatusState,
  SyncStatusType
} from '@/app/components/gr-availability/types'

interface AvailabilitySummaryProps {
  exportStatus: StatusState<ExportStatusType>
  syncStatus: StatusState<SyncStatusType>
  players: PlayerAvailability[]
  totalTokensAvailable: number
  totalBombsAvailable: number
  cappedPlayers: number
  playersWithApiKeys: Set<string>
}

export const AvailabilitySummary = ({
  exportStatus,
  syncStatus,
  players,
  totalTokensAvailable,
  totalBombsAvailable,
  cappedPlayers,
  playersWithApiKeys
}: AvailabilitySummaryProps) => {
  return (
    <>
      {/* Export Status Message */}
      {exportStatus.type && (
        <div
          className={`
              mb-3 px-3 py-2 rounded-md text-xs font-medium
              transition-all duration-300 animate-in fade-in slide-in-from-top-1
              ${
                exportStatus.type === 'success'
                  ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                  : 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent) border border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
              }
	            `}
        >
          <div className="flex items-center gap-2">
            <StatusMessageIcon type={exportStatus.type} />
            <span>{exportStatus.message}</span>
          </div>
        </div>
      )}

      {/* Sync Status Message - Shows near the sync button */}
      {syncStatus.type && (
        <div
          className={`
              mb-3 px-3 py-2 rounded-md text-xs font-medium
              transition-all duration-300 animate-in fade-in slide-in-from-top-1
              ${
                syncStatus.type === 'success'
                  ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                  : syncStatus.type === 'error'
                    ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent) border border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
                    : syncStatus.type === 'warning'
                      ? 'bg-amber-500/15 text-amber-200 border border-amber-500/25'
                      : 'bg-[color-mix(in_srgb,var(--primary)_15%,transparent)] text-(--accent) border border-[color-mix(in_srgb,var(--primary)_25%,transparent)]'
              }
	            `}
        >
          <div className="flex items-center gap-2">
            <StatusMessageIcon type={syncStatus.type} />
            <span>{syncStatus.message}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 sm:gap-2 mb-3">
        <div>
          <p className="text-[10px] text-(--text-tertiary) uppercase tracking-wider font-medium">
            Players
          </p>
          <p className="text-base sm:text-lg font-bold text-primary-wh40k">
            {players.length}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-(--text-tertiary) uppercase tracking-wider font-medium">
            Tokens
          </p>
          <p className="text-base sm:text-lg font-bold text-(--success)">
            {totalTokensAvailable}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-(--text-tertiary) uppercase tracking-wider">
            Bombs
          </p>
          <p className="text-base sm:text-lg font-bold text-(--accent)">
            {totalBombsAvailable}
          </p>
        </div>
        <div className="hidden sm:block">
          <p className="text-[10px] text-(--text-tertiary) uppercase tracking-wider">
            Capped
          </p>
          <p className="text-base sm:text-lg font-bold text-(--accent)">
            {cappedPlayers}
          </p>
        </div>
        <div className="hidden sm:block">
          <p className="text-[10px] text-(--text-tertiary) uppercase tracking-wider">
            API Keys
          </p>
          <p className="text-base sm:text-lg font-bold text-emerald-400">
            {playersWithApiKeys.size}
          </p>
        </div>
      </div>
    </>
  )
}
