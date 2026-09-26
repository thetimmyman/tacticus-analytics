'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import type {
  HeroRequirement,
  StrengthThresholds
} from '@/app/lib/meta/roster-strength'
import type {
  TeamFloorResponse,
  TeamFloorUnit
} from '../hooks/useMetaAtlasTeamFloor'
import type { UpgradeStep } from '../types'
import { normalizeHeroKey, type HeroMapping } from '../utils/hero-mapping'
import {
  resolveRankLabel,
  resolveRosterStars,
  type SourceMode,
  type TeamUnitInfo
} from './personal-potential-model'
import { UpgradePathMetro } from './UpgradePathMetro'

type FloorUnitLookupEntry = {
  min_rank_name: string | null
  min_rank_index: number | null
  min_stars: number | null
}

type PersonalPotentialUpgradeSectionProps = {
  resolvedDeltaLabel: string | null
  resolvedDeltaTone: string
  resolvedCurrentDamage: number | null
  resolvedTargetDamage: number | null
  resolvedSourceMode: SourceMode
  pathBaseTeam: string | null | undefined
  resolvedTargetTeam: string | null | undefined
  pathBaseDamage: number | null | undefined
  upgradePath: UpgradeStep[]
  rosterDefaultIndex: number | null
  activeBadgeLabel: string
  heroMappings: Map<string, HeroMapping>
  rosterEntries: RosterInputEntry[]
  strengthThresholds: StrengthThresholds
  heroOverrides: Map<string, HeroRequirement> | null
  overrideMetaTeam: string | null
  showTeamFloor: boolean
  teamFloorQuery: { isLoading: boolean }
  teamFloor: TeamFloorResponse | undefined
  teamFloorUnits: TeamFloorUnit[]
  targetTeamUnits: TeamUnitInfo[]
  floorUnitLookup: Map<string, FloorUnitLookupEntry>
  findRosterEntry: (unit: TeamUnitInfo) => RosterInputEntry | null
}

export function PersonalPotentialUpgradeSection({
  resolvedDeltaLabel,
  resolvedDeltaTone,
  resolvedCurrentDamage,
  resolvedTargetDamage,
  resolvedSourceMode,
  pathBaseTeam,
  resolvedTargetTeam,
  pathBaseDamage,
  upgradePath,
  rosterDefaultIndex,
  activeBadgeLabel,
  heroMappings,
  rosterEntries,
  strengthThresholds,
  heroOverrides,
  overrideMetaTeam,
  showTeamFloor,
  teamFloorQuery,
  teamFloor,
  teamFloorUnits,
  targetTeamUnits,
  floorUnitLookup,
  findRosterEntry
}: PersonalPotentialUpgradeSectionProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-emerald-300">
        <span>Upgrade Line</span>
        {resolvedDeltaLabel && (
          <span className={resolvedDeltaTone}>Net {resolvedDeltaLabel}</span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-4 text-[11px] text-[var(--text-primary)]">
        <div>
          <span className="text-[var(--text-secondary)] uppercase tracking-wide text-[9px]">
            Current P90{' '}
          </span>
          <span className="text-emerald-200 font-semibold">
            {resolvedCurrentDamage != null
              ? formatNumber(resolvedCurrentDamage)
              : '--'}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-secondary)] uppercase tracking-wide text-[9px]">
            Target P90{' '}
          </span>
          <span className="text-amber-200 font-semibold">
            {resolvedTargetDamage != null
              ? formatNumber(resolvedTargetDamage)
              : '--'}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-secondary)] uppercase tracking-wide text-[9px]">
            Net{' '}
          </span>
          <span className={`font-semibold ${resolvedDeltaTone}`}>
            {resolvedDeltaLabel ?? '--'}
          </span>
        </div>
      </div>
      <UpgradePathMetro
        currentLabel={
          resolvedSourceMode === 'history' ? 'Current Team' : 'Buildable Start'
        }
        currentTeam={pathBaseTeam}
        targetTeam={resolvedTargetTeam}
        currentDamage={pathBaseDamage}
        targetDamage={resolvedTargetDamage}
        steps={upgradePath}
        defaultActiveIndex={
          resolvedSourceMode === 'roster'
            ? (rosterDefaultIndex ?? 0)
            : undefined
        }
        activeBadgeLabel={activeBadgeLabel}
        heroMappings={heroMappings}
        rosterEntries={rosterEntries}
        strengthThresholds={strengthThresholds}
        heroOverrides={heroOverrides ?? undefined}
        overrideMetaTeam={overrideMetaTeam}
      />
      {showTeamFloor && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
            <span>Minimums (P90 floor)</span>
            {teamFloorQuery.isLoading ? (
              <span className="text-[var(--text-secondary)]">Loading...</span>
            ) : teamFloor ? (
              <span className="text-[var(--text-secondary)]">
                {teamFloor.sample_hits} hits / {teamFloor.sample_players}{' '}
                players
              </span>
            ) : null}
          </div>
          {teamFloorUnits.length === 0 ? (
            <div className="mt-3 text-xs text-[var(--text-secondary)]">
              No floor data available yet.
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {targetTeamUnits.map((unit) => {
                const floorEntry = floorUnitLookup.get(
                  normalizeHeroKey(unit.unitId)
                )
                const rosterEntry = findRosterEntry(unit)
                const rosterRank =
                  rosterEntry &&
                  typeof rosterEntry !== 'string' &&
                  typeof rosterEntry.rank === 'number'
                    ? rosterEntry.rank
                    : null
                const rosterStars = resolveRosterStars(rosterEntry)
                const minRankIndex = floorEntry?.min_rank_index ?? null
                const minStars = floorEntry?.min_stars ?? null
                const minRankLabel =
                  floorEntry?.min_rank_name ?? resolveRankLabel(minRankIndex)
                const rosterRankLabel = resolveRankLabel(rosterRank)
                const hasRosterEntry = Boolean(rosterEntry)
                const hasFloorEntry = Boolean(floorEntry)
                const hasMinData = minRankIndex != null || minStars != null

                const rankKnown = minRankIndex == null || rosterRank != null
                const starsKnown = minStars == null || rosterStars != null
                const rankOk =
                  minRankIndex == null ||
                  (rosterRank != null && rosterRank >= minRankIndex)
                const starsOk =
                  minStars == null ||
                  (rosterStars != null && rosterStars >= minStars)
                const status =
                  !hasFloorEntry || !hasMinData
                    ? 'unknown'
                    : !hasRosterEntry
                      ? 'missing'
                      : rankKnown && starsKnown
                        ? rankOk && starsOk
                          ? 'ready'
                          : 'invest'
                        : 'unknown'
                const statusLabel =
                  status === 'ready'
                    ? 'Suitable'
                    : status === 'invest'
                      ? 'Invest'
                      : status === 'missing'
                        ? 'Locked'
                        : 'Unknown'
                const statusTone =
                  status === 'ready'
                    ? 'text-amber-200 border-amber-500/40 bg-amber-500/10'
                    : status === 'invest'
                      ? 'text-rose-200 border-rose-500/40 bg-rose-500/10'
                      : status === 'missing'
                        ? 'text-[var(--text-primary)] border-slate-500/40 bg-slate-500/10'
                        : 'text-[var(--text-secondary)] border-[var(--card-border)] bg-card/50'
                const minStarsLabel =
                  minStars != null ? `${minStars} stars` : '-- stars'
                const minLabel = `${minRankLabel ?? '--'} / ${minStarsLabel}`
                const rosterStarsLabel =
                  rosterStars != null ? `${rosterStars} stars` : '-- stars'
                const rosterLabel = hasRosterEntry
                  ? `${rosterRankLabel ?? '--'} / ${rosterStarsLabel}`
                  : 'Not owned'

                return (
                  <div
                    key={unit.unitId}
                    className="flex flex-col items-center text-center gap-0.5 rounded-lg border border-white/10 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] px-1.5 py-1.5"
                  >
                    <div
                      className="h-8 w-8 rounded-full border border-white/20 bg-card/70 overflow-hidden flex items-center justify-center"
                      title={unit.displayName}
                    >
                      {unit.iconUrl ? (
                        <img
                          src={unit.iconUrl}
                          alt={unit.displayName}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[10px] text-[var(--text-secondary)] font-semibold">
                          {unit.displayName.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[11px] text-[var(--text-primary)] truncate max-w-[6rem]"
                      title={unit.displayName}
                    >
                      {unit.displayName}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)]">
                      Min: {minLabel}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)]">
                      You: {rosterLabel}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusTone}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}
