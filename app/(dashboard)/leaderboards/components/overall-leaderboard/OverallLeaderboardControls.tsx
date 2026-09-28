'use client'

import { DebouncedInput } from '@/app/components/performance/PerformanceWrapper'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import type { UserDataContext } from '@/app/lib/utils/data-access'
import type { ScoringMode, ScoringPresentation } from './types'

interface OverallLeaderboardControlsProps {
  season: string
  context: UserDataContext
  contextGuildLabel: string
  totalPlayers: number
  scoring: ScoringPresentation
  searchTerm: string
  selectedGuild: string
  uniqueGuilds: string[]
  guildLabels: Record<string, string>
  onScoringModeChange: (mode: ScoringMode) => void
  onSearchChange: (value: string) => void
  onGuildChange: (guild: string) => void
}

export function OverallLeaderboardControls({
  season,
  context,
  contextGuildLabel,
  totalPlayers,
  scoring,
  searchTerm,
  selectedGuild,
  uniqueGuilds,
  guildLabels,
  onScoringModeChange,
  onSearchChange,
  onGuildChange
}: OverallLeaderboardControlsProps) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-bold text-primary-wh40k">
          Top Players -{' '}
          {context.accessLevel === 'cluster'
            ? `${context.clusterCode} Cluster`
            : `${context.guildLabel || contextGuildLabel} Guild`}{' '}
          - Season {season}
        </h3>
        <div className="text-sm text-secondary-wh40k">
          Showing {totalPlayers} players
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 lg:px-4">
        <div className="flex flex-col items-center leading-tight">
          <span className="text-secondary-wh40k text-xs uppercase tracking-wide">
            Scoring Basis
          </span>
          <span className="text-sm font-semibold text-primary-wh40k">
            {scoring.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onScoringModeChange('battle')}
            className={`px-3 py-1.5 rounded-md border text-xs sm:text-sm font-semibold transition-all ${
              !scoring.isTokenModeActive
                ? 'bg-primary-wh40k text-(--bg-primary) border-primary-wh40k shadow-md'
                : 'bg-(--card-bg) border-(--card-border) text-primary-wh40k hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]'
            }`}
          >
            Battle Weighted
            <span
              className={`ml-1.5 rounded px-1 text-[10px] font-medium uppercase tracking-wide ${
                !scoring.isTokenModeActive
                  ? 'bg-black/15 text-(--bg-primary)'
                  : 'bg-[color-mix(in_srgb,var(--primary)_15%,transparent)] text-secondary-wh40k'
              }`}
            >
              Default
            </span>
          </button>
          <button
            type="button"
            onClick={() => onScoringModeChange('token-max')}
            disabled={!scoring.tokenMaxAvailable}
            className={`px-3 py-1.5 rounded-md border text-xs sm:text-sm font-semibold transition-all ${
              scoring.isTokenModeActive && scoring.tokenWeightingMode === 'max'
                ? 'bg-primary-wh40k text-(--bg-primary) border-primary-wh40k shadow-md'
                : 'bg-(--card-bg) border-(--card-border) text-primary-wh40k hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]'
            } ${!scoring.tokenMaxAvailable ? 'opacity-50 cursor-not-allowed hover:border-(--card-border)' : ''}`}
          >
            Token Weighted (Max)
          </button>
          <button
            type="button"
            onClick={() => onScoringModeChange('token-average')}
            disabled={!scoring.tokenAverageAvailable}
            className={`px-3 py-1.5 rounded-md border text-xs sm:text-sm font-semibold transition-all ${
              scoring.isTokenModeActive &&
              scoring.tokenWeightingMode === 'average'
                ? 'bg-primary-wh40k text-(--bg-primary) border-primary-wh40k shadow-md'
                : 'bg-(--card-bg) border-(--card-border) text-primary-wh40k hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]'
            } ${!scoring.tokenAverageAvailable ? 'opacity-50 cursor-not-allowed hover:border-(--card-border)' : ''}`}
          >
            Token Weighted (Avg)
          </button>
        </div>
        <p
          className={`text-xs text-center ${scoring.hasAnyTokenMode ? 'text-secondary-wh40k' : 'text-red-400'}`}
        >
          {scoring.statusMessage}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full lg:w-auto lg:items-end">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <DebouncedInput
            type="text"
            placeholder="Search player..."
            value={searchTerm}
            onChange={onSearchChange}
            delay={300}
            className="w-full sm:w-48 lg:w-56 px-3 py-1.5 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k placeholder-(--text-secondary) text-sm"
          />
          <select
            value={selectedGuild}
            onChange={(event) => onGuildChange(event.target.value)}
            className="w-full sm:w-40 lg:w-44 px-3 py-1.5 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k text-sm"
          >
            <option value="all">All Guilds</option>
            {uniqueGuilds.map((guild) => (
              <option key={guild} value={guild}>
                {guildLabels[guild] ?? formatGuildDisplayLabel(null, guild)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
