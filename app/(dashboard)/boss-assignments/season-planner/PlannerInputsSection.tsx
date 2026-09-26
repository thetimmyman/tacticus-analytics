'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Filter } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type { PlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot-types'
import type { SeasonConfigInfo } from '@/app/(dashboard)/boss-playbooks/types'
import {
  IS_DEV,
  parseBoundedIntInput
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type { GeneratedSeasonPlanPayload } from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

interface PlannerInputsSectionProps {
  snapshot: PlanFromNowSnapshot | null
  snapshotLoading: boolean
  snapshotError: string | null
  loadSnapshot: (options?: {
    configId?: string | null
    selectedConfig?: string
  }) => Promise<void>
  clearGeneratedPlanState: (options?: { clearSnapshot?: boolean }) => void
  selectedSeasonConfig: string
  setSelectedSeasonConfig: Dispatch<SetStateAction<string>>
  allSeasons: SeasonConfigInfo[]
  detectedConfigId: string | null
  season: string
  setSeason: Dispatch<SetStateAction<string>>
  liveConfigId?: string | null
  seasonConfigByNumber: Map<number, string>
  lookbackDays: number
  setLookbackDays: Dispatch<SetStateAction<number>>
  sessionsPerDay: number
  setSessionsPerDay: Dispatch<SetStateAction<number>>
  timeZone: string
  setTimeZone: Dispatch<SetStateAction<string>>
  timeZoneOptions: string[]
  generatePlan: () => Promise<void>
  planLoading: boolean
  loadingSavedPlanId: string | null
  canEdit: boolean
  savePlan: () => Promise<void>
  saveLoading: boolean
  plan: GeneratedSeasonPlanPayload | null
  showRaw: boolean
  setShowRaw: Dispatch<SetStateAction<boolean>>
  planError: string | null
  saveError: string | null
  saveSuccess: string | null
}

export default function PlannerInputsSection({
  snapshot,
  snapshotLoading,
  snapshotError,
  loadSnapshot,
  clearGeneratedPlanState,
  selectedSeasonConfig,
  setSelectedSeasonConfig,
  allSeasons,
  detectedConfigId,
  season,
  setSeason,
  liveConfigId,
  seasonConfigByNumber,
  lookbackDays,
  setLookbackDays,
  sessionsPerDay,
  setSessionsPerDay,
  timeZone,
  setTimeZone,
  timeZoneOptions,
  generatePlan,
  planLoading,
  loadingSavedPlanId,
  canEdit,
  savePlan,
  saveLoading,
  plan,
  showRaw,
  setShowRaw,
  planError,
  saveError,
  saveSuccess
}: PlannerInputsSectionProps) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Inputs
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Tune the generation settings and create a new plan from the latest
            synced data.
          </p>
        </div>
        <button
          onClick={() => void loadSnapshot()}
          disabled={snapshotLoading}
          className="px-3 py-2 rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)] hover:bg-card/80 disabled:opacity-50"
        >
          {snapshotLoading ? 'Refreshing…' : 'Refresh Snapshot'}
        </button>
      </div>

      {snapshotError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {snapshotError}
        </div>
      )}

      {snapshot && (
        <div
          className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4 text-sm text-[var(--text-secondary)]"
          // Tests wait on this for a refreshed snapshot; the enabled buttons could race the refresh.
          data-testid="snapshot-panel"
          data-snapshot-at={snapshot.snapshotAt}
        >
          <div className="flex flex-wrap gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                Season
              </div>
              <div className="text-[var(--text-primary)]">
                {snapshot.season}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                Stage
              </div>
              <div className="text-[var(--text-primary)]">
                {snapshot.stageCode} (Loop {snapshot.loopIndex})
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                Main Boss
              </div>
              <div className="text-[var(--text-primary)]">
                {getBossDisplayName(snapshot.encounters.main.bossName)} (
                {formatNumber(snapshot.encounters.main.remainingHp)} /{' '}
                {formatNumber(snapshot.encounters.main.maxHp)})
              </div>
            </div>
          </div>
          {snapshot.warnings?.length > 0 && (
            <div className="mt-3 text-xs text-amber-300">
              Snapshot warnings: {snapshot.warnings.join(' · ')}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <label className="space-y-1">
          <span className="text-xs text-[var(--text-secondary)]">
            Boss Rotation
          </span>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
            <select
              value={selectedSeasonConfig}
              onChange={(e) => {
                const newConfig = e.target.value
                clearGeneratedPlanState({ clearSnapshot: true })
                setSelectedSeasonConfig(newConfig)
                void loadSnapshot({
                  configId: newConfig === 'current' ? null : newConfig,
                  selectedConfig: newConfig
                })
              }}
              className="w-full pl-10 pr-3 py-2 rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)] appearance-none cursor-pointer"
            >
              {allSeasons.map((seasonCfg) => (
                <option key={seasonCfg.id} value={seasonCfg.id}>
                  Config {seasonCfg.index}
                  {seasonCfg.id === detectedConfigId ? ' (Detected)' : ''}
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--text-secondary)]">
            Season (optional)
          </span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={season}
            onChange={(e) => {
              // Positive integers only; empty = latest.
              const raw = e.target.value.trim()
              if (raw === '') {
                clearGeneratedPlanState({ clearSnapshot: true })
                setSeason('')
                setSelectedSeasonConfig(
                  liveConfigId ?? detectedConfigId ?? 'current'
                )
                return
              }
              const parsed = Number.parseInt(raw, 10)
              if (Number.isFinite(parsed) && parsed > 0) {
                clearGeneratedPlanState({ clearSnapshot: true })
                const configIdForSeason = seasonConfigByNumber.get(parsed)
                if (configIdForSeason) {
                  setSelectedSeasonConfig(configIdForSeason)
                }
                setSeason(String(parsed))
              }
            }}
            placeholder="latest"
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--text-secondary)]">
            Lookback days
          </span>
          <input
            type="number"
            min={1}
            max={180}
            value={lookbackDays}
            onChange={(e) => {
              clearGeneratedPlanState()
              setLookbackDays(parseBoundedIntInput(e.target.value, 30, 1, 180))
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--text-secondary)]">
            Sessions/day
          </span>
          <select
            value={sessionsPerDay}
            onChange={(e) => {
              clearGeneratedPlanState()
              setSessionsPerDay(Number(e.target.value))
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-[var(--text-secondary)]">
            Time zone
          </span>
          <select
            value={timeZone}
            onChange={(e) => {
              clearGeneratedPlanState()
              setTimeZone(e.target.value)
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-primary)] cursor-pointer"
          >
            {timeZoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void generatePlan()}
          disabled={planLoading || loadingSavedPlanId !== null}
          className="px-4 py-2 rounded-md bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_30%,transparent)] disabled:opacity-50 text-sm font-medium"
        >
          {planLoading ? 'Generating…' : 'Generate Plan'}
        </button>
        {canEdit && (
          <button
            onClick={() => void savePlan()}
            disabled={saveLoading || !plan}
            className="px-4 py-2 rounded-md bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50 text-sm font-medium"
          >
            {saveLoading ? 'Saving…' : 'Save Plan'}
          </button>
        )}
        {IS_DEV && (
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="h-4 w-4"
            />
            Show raw JSON
          </label>
        )}
      </div>

      {planError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {planError}
        </div>
      )}
      {saveError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300">
          {saveSuccess}
        </div>
      )}
    </div>
  )
}
