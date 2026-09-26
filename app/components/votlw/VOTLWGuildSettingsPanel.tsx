'use client'

import { useState, useTransition } from 'react'
import { Shield, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { Button, StatusLabel } from '@tacticus/ui-kit'
import type { UserRole } from '@tacticus/app-core/types'
import { useToast } from '@/app/hooks/useToast'
import { updateVOTLWSettingsAction } from './actions'

interface VOTLWGuildSettingsPanelProps {
  guildCode: string
  userRole: UserRole
  initialApplyTokenOffenderFiltering: boolean
  initialOffenderThreshold: number
  initialAbuserThreshold: number
  onSettingsSaved?: () => void
}

const MIN_THRESHOLD = 1
const MAX_THRESHOLD = 14

function clampThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, Math.round(value)))
}

export default function VOTLWGuildSettingsPanel({
  guildCode,
  userRole,
  initialApplyTokenOffenderFiltering,
  initialOffenderThreshold,
  initialAbuserThreshold,
  onSettingsSaved
}: VOTLWGuildSettingsPanelProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const canEdit = userRole === 'leader' || userRole === 'officer'

  const [applyFiltering, setApplyFiltering] = useState(
    initialApplyTokenOffenderFiltering
  )
  const [offenderThreshold, setOffenderThreshold] = useState(
    initialOffenderThreshold
  )
  const [abuserThreshold, setAbuserThreshold] = useState(initialAbuserThreshold)

  if (!canEdit) {
    return null
  }

  const isDirty =
    applyFiltering !== initialApplyTokenOffenderFiltering ||
    offenderThreshold !== initialOffenderThreshold ||
    abuserThreshold !== initialAbuserThreshold

  const validationError =
    abuserThreshold < offenderThreshold
      ? 'Abuser threshold must be greater than or equal to the offender threshold.'
      : null

  const handleSave = () => {
    if (validationError) {
      toast.error('Invalid thresholds', validationError)
      return
    }

    startTransition(async () => {
      const result = await updateVOTLWSettingsAction({
        guildCode,
        applyTokenOffenderFiltering: applyFiltering,
        tokenOffenderThreshold: clampThreshold(offenderThreshold, 4),
        tokenAbuserThreshold: clampThreshold(abuserThreshold, 5)
      })

      if (result.success) {
        toast.success(
          'VOTLW settings saved',
          'Awards will reflect the new thresholds on next refresh.'
        )
        onSettingsSaved?.()
      } else {
        toast.error('Save failed', result.error)
      }
    })
  }

  return (
    <section className="rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-6 shadow-[0_18px_30px_rgba(4,8,20,0.35)]">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] text-[var(--accent)]">
            <Shield className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">
              VOTLW Award Controls
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Officer/Leader controls for how token usage affects medals and
              seasonal awards.
            </p>
          </div>
        </div>
        <StatusLabel
          type="warning"
          className="text-[10px] uppercase tracking-wide"
        >
          Officer + Leader
        </StatusLabel>
      </header>

      <div className="space-y-6">
        {/* Toggle */}
        <div className="rounded-xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-tertiary)_40%,transparent)] p-4">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--text-primary)]">
                  Apply token offender filtering
                </span>
                <StatusLabel
                  type={applyFiltering ? 'success' : 'inactive'}
                  size="xs"
                >
                  {applyFiltering ? 'On' : 'Off'}
                </StatusLabel>
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                When enabled, players who miss the configured number of tokens
                are excluded from medal math, set winners, and seasonal awards.
                Offenders are still tracked and shown elsewhere for
                transparency.
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 cursor-pointer accent-[var(--accent)]"
              checked={applyFiltering}
              disabled={isPending}
              onChange={(e) => setApplyFiltering(e.target.checked)}
            />
          </label>
        </div>

        {/* Thresholds */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-tertiary)_40%,transparent)] p-4">
            <label
              htmlFor="votlw-offender-threshold"
              className="block text-sm font-semibold text-[var(--text-primary)]"
            >
              Offender threshold
            </label>
            <p className="mb-3 mt-1 text-xs text-[var(--text-secondary)]">
              Players missing at least this many tokens are flagged as
              offenders.
            </p>
            <div className="flex items-center gap-3">
              <input
                id="votlw-offender-threshold"
                type="number"
                min={MIN_THRESHOLD}
                max={MAX_THRESHOLD}
                value={offenderThreshold}
                disabled={isPending}
                onChange={(e) =>
                  setOffenderThreshold(
                    clampThreshold(
                      Number(e.target.value),
                      initialOffenderThreshold
                    )
                  )
                }
                className="w-24 rounded-lg border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <span className="text-xs text-[var(--text-tertiary)]">
                tokens missed
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-tertiary)_40%,transparent)] p-4">
            <label
              htmlFor="votlw-abuser-threshold"
              className="block text-sm font-semibold text-[var(--text-primary)]"
            >
              Abuser threshold
            </label>
            <p className="mb-3 mt-1 text-xs text-[var(--text-secondary)]">
              Stricter cutoff for highlighting players who abuse their token
              budget. Must be ≥ the offender threshold.
            </p>
            <div className="flex items-center gap-3">
              <input
                id="votlw-abuser-threshold"
                type="number"
                min={MIN_THRESHOLD}
                max={MAX_THRESHOLD}
                value={abuserThreshold}
                disabled={isPending}
                onChange={(e) =>
                  setAbuserThreshold(
                    clampThreshold(
                      Number(e.target.value),
                      initialAbuserThreshold
                    )
                  )
                }
                className="w-24 rounded-lg border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <span className="text-xs text-[var(--text-tertiary)]">
                tokens missed
              </span>
            </div>
          </div>
        </div>

        {validationError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>{validationError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          {!isDirty && !isPending && (
            <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
              <CheckCircle className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || isPending || Boolean(validationError)}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              'Save VOTLW settings'
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}
