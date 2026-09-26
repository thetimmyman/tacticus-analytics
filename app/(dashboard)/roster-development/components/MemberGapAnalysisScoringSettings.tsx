'use client'

import type { Dispatch, SetStateAction } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { Save, SlidersHorizontal, Users } from 'lucide-react'
import {
  SOURCE_LABELS,
  parsePercent,
  type MemberGapsResponse,
  type PrimarySource,
  type ScoringConfig,
  type ScoringConfigResponse
} from './member-gap-analysis-shared'

interface MemberGapAnalysisScoringSettingsProps {
  data: MemberGapsResponse | null
  settingsOpen: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  configLoading: boolean
  configError: string | null
  configDraft: ScoringConfig | null
  setConfigDraft: Dispatch<SetStateAction<ScoringConfig | null>>
  configState: ScoringConfigResponse | null
  currentTiers: { optimal: number; strong: number; suitable: number }
  fallbackChain: PrimarySource[]
  tierInvalid: boolean
  configMessage: string | null
  configSaving: boolean
  saveConfig: () => Promise<void>
}

export function MemberGapAnalysisScoringSettings({
  data,
  settingsOpen,
  setSettingsOpen,
  configLoading,
  configError,
  configDraft,
  setConfigDraft,
  configState,
  currentTiers,
  fallbackChain,
  tierInvalid,
  configMessage,
  configSaving,
  saveConfig
}: MemberGapAnalysisScoringSettingsProps) {
  const activeSource = data?.active_source
  const activeLabel = activeSource
    ? SOURCE_LABELS[activeSource].title
    : 'No targets available'

  return (
    <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <SlidersHorizontal className="w-4 h-4" />
            Scoring Settings
          </CardTitle>
          <p className="text-xs text-[var(--text-secondary)]">
            Tune how roster development targets are scored.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSettingsOpen((prev) => !prev)}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {settingsOpen ? 'Hide' : 'Configure'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {configLoading && (
          <div className="py-3">
            <LoadingSpinner message="Loading scoring settings..." />
          </div>
        )}

        {!configLoading && configError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {configError}
          </div>
        )}

        {!configLoading && configDraft && configState && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-1">
                Active source:{' '}
                <span className="text-[var(--text-primary)]">
                  {activeLabel}
                </span>
              </span>
              {data?.targets_label && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-1">
                  {data.targets_label}:{' '}
                  <span className="text-[var(--text-primary)]">
                    {data.targets_analyzed.length}
                  </span>
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--card-border)] px-2 py-1">
                Tiers: {currentTiers.optimal}/{currentTiers.strong}/
                {currentTiers.suitable}
              </span>
            </div>

            {settingsOpen && (
              <div className="space-y-5 border-t border-[var(--card-border)] pt-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Based on
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {Object.entries(SOURCE_LABELS).map(([key, meta]) => {
                      const source = key as PrimarySource
                      const selected = configDraft.primary_source === source
                      return (
                        <label
                          key={source}
                          className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                            selected
                              ? 'border-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
                              : 'border-[var(--card-border)] hover:border-[color-mix(in_srgb,var(--primary)_40%,transparent)]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="primary_source"
                            value={source}
                            checked={selected}
                            onChange={() =>
                              setConfigDraft({
                                ...configDraft,
                                primary_source: source
                              })
                            }
                            className="mt-1"
                          />
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.badgeClass}`}
                              >
                                {meta.short}
                              </span>
                              <span className="text-sm font-semibold text-[var(--text-primary)]">
                                {meta.title}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--text-secondary)]">
                              {meta.description}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Strength target
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[260px_1fr] items-center">
                    <select
                      value={configDraft.strength_target_rarity_set ?? ''}
                      onChange={(event) =>
                        setConfigDraft({
                          ...configDraft,
                          strength_target_rarity_set: event.target.value || null
                        })
                      }
                      className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    >
                      <option value="">
                        Default ({configState.default_rarity_set ?? 'Auto'})
                      </option>
                      {configState.available_rarity_sets.map((set) => (
                        <option key={set} value={set}>
                          {set}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Applied whenever global thresholds are used in the
                      fallback chain.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Tier thresholds (percent)
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="space-y-1 text-xs text-[var(--text-secondary)]">
                      Optimal
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={configDraft.tier_optimal_pct}
                        onChange={(event) =>
                          setConfigDraft({
                            ...configDraft,
                            tier_optimal_pct: parsePercent(
                              event.target.value,
                              configDraft.tier_optimal_pct
                            )
                          })
                        }
                        className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-[var(--text-secondary)]">
                      Strong
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={configDraft.tier_strong_pct}
                        onChange={(event) =>
                          setConfigDraft({
                            ...configDraft,
                            tier_strong_pct: parsePercent(
                              event.target.value,
                              configDraft.tier_strong_pct
                            )
                          })
                        }
                        className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-[var(--text-secondary)]">
                      Suitable
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={configDraft.tier_suitable_pct}
                        onChange={(event) =>
                          setConfigDraft({
                            ...configDraft,
                            tier_suitable_pct: parsePercent(
                              event.target.value,
                              configDraft.tier_suitable_pct
                            )
                          })
                        }
                        className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)]"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Weak is anything below the Suitable threshold.
                  </p>
                  {tierInvalid && (
                    <div className="text-xs text-red-300">
                      Tier thresholds must be descending.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">
                    Fallback chain
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fallbackChain.map((source) => {
                      const meta = SOURCE_LABELS[source]
                      const isActive = data?.active_source === source
                      return (
                        <span
                          key={source}
                          className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[10px] ${meta.badgeClass} ${isActive ? 'ring-1 ring-white/30' : 'opacity-70'}`}
                        >
                          {isActive && <Users className="w-3 h-3" />}
                          {meta.short}
                        </span>
                      )
                    })}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    The first source with available targets is used
                    automatically.
                  </p>
                </div>

                {configMessage && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-200">
                    {configMessage}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--text-secondary)]">
                    {configState.can_edit
                      ? 'Changes apply immediately.'
                      : 'Leader access required to edit.'}
                  </div>
                  {configState.can_edit && (
                    <Button
                      onClick={saveConfig}
                      disabled={configSaving || tierInvalid}
                      className="flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      {configSaving ? 'Saving...' : 'Save settings'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
