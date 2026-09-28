'use client'

import { Card, CardContent } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { formatNumber } from '@tacticus/app-core/formatters'
import { ChevronRight, Users } from 'lucide-react'
import type { StrengthState } from '@/app/lib/meta/roster-strength'
import { resolveHeroMapping, type HeroMapping } from '../utils/hero-mapping'

type RosterRoiEntry = {
  hero_name: string
  unlock_count: number
  total_damage_gain: number
  bosses: string[]
  investment_state?: StrengthState | null
}

type RosterROIWidgetProps = {
  entries: RosterRoiEntry[]
  isLoading: boolean
  heroMappings: Map<string, HeroMapping>
  onSelectBoss?: (bossType: string) => void
  hasRoster: boolean
  rosterError?: unknown
  message?: string
}

function getRoiLabel(index: number) {
  if (index === 0)
    return {
      label: 'High ROI',
      className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    }
  if (index === 1)
    return {
      label: 'Essential',
      className: 'bg-amber-500/10 text-amber-300 border-amber-500/20'
    }
  return {
    label: 'Medium ROI',
    className: 'bg-sky-500/10 text-sky-300 border-sky-500/20'
  }
}

function getInvestmentAction(state?: StrengthState | null) {
  if (state === 'Locked') return 'Unlock'
  return 'Invest in'
}

function getInvestmentStatus(state?: StrengthState | null) {
  if (!state || state === 'Optimal') return null
  if (state === 'Invalid') return 'Needs data'
  return state
}

export function RosterROIWidget({
  entries,
  isLoading,
  heroMappings,
  onSelectBoss,
  hasRoster,
  rosterError,
  message
}: RosterROIWidgetProps) {
  return (
    <Card className="bg-(--card-bg) border-(--card-border)">
      <CardContent className="py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-secondary-wh40k">
              High Value Investments
            </div>
            <div className="text-sm text-secondary-wh40k">
              Focus on these investments for the biggest upgrade paths.
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
          >
            View All <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {!!rosterError && (
          <div className="py-4 text-sm text-red-400">
            Unable to load roster details. Please refresh or re-sync your
            roster.
          </div>
        )}

        {!rosterError && !hasRoster && (
          <div className="py-4 text-sm text-secondary-wh40k">
            Connect your roster to see personalized investments.
          </div>
        )}

        {!rosterError && hasRoster && isLoading && (
          <div className="flex justify-center py-6">
            <LoadingSpinner />
          </div>
        )}

        {!rosterError && hasRoster && !isLoading && message && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {message}
          </div>
        )}

        {!rosterError &&
          hasRoster &&
          !isLoading &&
          entries.length === 0 &&
          !message && (
            <div className="py-4 text-sm text-secondary-wh40k">
              {message || 'No high value investments found yet.'}
            </div>
          )}

        {hasRoster && !rosterError && entries.length > 0 && (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {entries.map((entry, index) => {
              const mapping = resolveHeroMapping(entry.hero_name, heroMappings)
              const displayName = mapping?.display_name || entry.hero_name
              const badge = getRoiLabel(index)
              const actionLabel = getInvestmentAction(entry.investment_state)
              const statusLabel = getInvestmentStatus(entry.investment_state)
              return (
                <div
                  key={entry.hero_name}
                  className="shrink-0 w-52 p-3 rounded-lg bg-linear-to-br from-white/5 to-white/2 border border-white/10 hover:border-white/20 transition-all cursor-pointer"
                  onClick={() => {
                    if (entry.bosses[0] && onSelectBoss) {
                      onSelectBoss(entry.bosses[0])
                    }
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-(--card-bg) flex items-center justify-center border border-white/5 shrink-0">
                      {mapping?.web_icon_url ? (
                        <img
                          src={mapping.web_icon_url}
                          alt={displayName}
                          title={displayName}
                          className="w-8 h-8 rounded-sm"
                          loading="lazy"
                        />
                      ) : (
                        <Users className="w-5 h-5 text-secondary-wh40k" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-white text-sm font-semibold truncate">
                        {displayName}
                      </h3>
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-sm text-[9px] uppercase font-bold border ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-secondary-wh40k">
                    {actionLabel} · {entry.unlock_count} upgrade
                    {entry.unlock_count !== 1 ? 's' : ''}
                  </p>
                  {statusLabel && (
                    <p className="text-[9px] uppercase text-secondary-wh40k mt-0.5">
                      {statusLabel}
                    </p>
                  )}
                  {entry.total_damage_gain > 0 && (
                    <p className="text-xs text-emerald-400 mt-1">
                      +{formatNumber(entry.total_damage_gain)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
