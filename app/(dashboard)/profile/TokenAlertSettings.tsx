'use client'

import { Switch, Button } from '@tacticus/ui-kit'
import {
  Bell,
  Bomb,
  Clock,
  Flame,
  Loader2,
  Moon,
  Save as SaveIcon,
  AlertTriangle
} from 'lucide-react'
import { useTokenAlertSettings } from './useTokenAlertSettings'
import {
  DEFAULT_QUIET_END,
  DEFAULT_QUIET_START,
  detectTimeZone
} from './token-alert-settings-model'

// Toggles need a linked Discord (also enforced on PUT); nothing renders when `available: false`.

// Offered values within the `alert_before_full_minutes` CHECK (15..720).
const MINUTE_OPTIONS = [30, 60, 90, 120, 180, 240, 360, 480, 720]

// DB range 11..168 hours; 11h matches the full-alert anti-flap window.
const FULL_REPEAT_HOUR_OPTIONS = [11, 12, 24, 48, 72, 168]

// Bomb regen is 18h (DB cap 960 min); a window equal to it would fire as soon as a bomb is spent.
const BOMB_MINUTE_OPTIONS = [30, 60, 120, 180, 240, 360, 480, 720, 960]

// DB range 15..360; the 6h ceiling must stay below the 11h burn re-alert hysteresis.
const BURN_MINUTE_OPTIONS = [15, 30, 60, 90, 120, 180, 240, 360]

// DB range 15..180.
const PRE_QUIET_MINUTE_OPTIONS = [15, 30, 45, 60, 90, 120, 180]

function formatMinutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  const hours = minutes / 60
  const hoursLabel = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
  return `${hoursLabel} hour${hours === 1 ? '' : 's'}`
}

/** 0 -> "12 AM", 13 -> "1 PM"; whole hours, matching the smallint columns. */
function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:00 ${suffix}`
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour)

function PanelHeading() {
  return (
    <>
      <h2 className="text-lg font-semibold text-primary-wh40k mb-1 flex items-center gap-2">
        <Bell className="w-5 h-5 text-(--accent)" />
        Token Alert DMs
      </h2>
      <p className="text-sm text-secondary-wh40k mb-4">
        Get a Discord DM when your raid tokens are full, about to cap, about to
        burn, or every time you gain one — and optionally when a raid bomb is
        ready.
      </p>
    </>
  )
}

/** Discord only DMs users sharing a server with the bot, so toggles would opt into nothing. */
function BotSetupCta({ canSetupBot }: { canSetupBot: boolean }) {
  return (
    <div className="card-wh40k p-6">
      <PanelHeading />
      <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-amber-200 space-y-2">
        <p>
          Token alerts arrive as DMs from the Tacticus Analytics Discord bot,
          and Discord only lets the bot message players who share a server with
          it — your guild&apos;s Discord server doesn&apos;t have the bot
          installed yet.
        </p>
        {canSetupBot ? (
          <a
            href="/guild-management/settings"
            className="inline-flex px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 transition-colors"
          >
            Set up the Tacticus Analytics Discord bot
          </a>
        ) : (
          <p>
            Ask your guild leader to set up the Tacticus Analytics Discord bot.
            Once your guild&apos;s server has it, your alert settings unlock
            here.
          </p>
        )}
      </div>
    </div>
  )
}

export function TokenAlertSettings() {
  const {
    loading,
    available,
    linked,
    dmBlocked,
    botInstalled,
    canSetupBot,
    draft,
    setDraft,
    saving,
    error,
    success,
    needsLink,
    showBombDetails,
    quietHoursOn,
    quietHoursInvalid,
    fullRepeatEnabled,
    canSave,
    setBombsGroup,
    setQuietHours,
    handleSave
  } = useTokenAlertSettings()

  // No flash of "unavailable" before the first fetch.
  if (loading || !available) return null

  // Only an explicit `false` lands here; the server still accepts saves.
  if (!botInstalled) return <BotSetupCta canSetupBot={canSetupBot} />

  const disableToggles = !linked || saving

  return (
    <div className="card-wh40k p-6">
      <PanelHeading />

      {!linked && (
        <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span>Link your Discord account to enable token alert DMs.</span>
          <a
            href="#connected-accounts"
            className="inline-flex px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 transition-colors shrink-0"
          >
            Link Discord
          </a>
        </div>
      )}

      {dmBlocked && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-200">
          We couldn&apos;t DM you (DMs from server members may be off). Fix your
          Discord privacy settings, then save to retry.
        </div>
      )}

      <div className="space-y-2">
        <ToggleRow
          label="Alert when tokens are full"
          checked={draft.alert_on_full}
          onCheckedChange={(next) =>
            setDraft((d) => ({
              ...d,
              alert_on_full: next,
              // Clear the subordinate cadence when the parent turns off (the DB enforces it).
              alert_on_full_repeat_hours: next
                ? d.alert_on_full_repeat_hours
                : null
            }))
          }
          disabled={disableToggles}
        />

        <div className="flex items-start justify-between gap-4 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5">
          <div className="flex items-start gap-3 min-w-0">
            <Clock className="w-4 h-4 mt-0.5 text-secondary-wh40k shrink-0" />
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium text-primary-wh40k">
                Repeat reminders while still full
              </p>
              <p className="text-xs text-secondary-wh40k">
                Re-send the full-token reminder if you remain capped.
              </p>
              {fullRepeatEnabled && (
                <>
                  <label
                    htmlFor="token-alert-full-repeat-hours"
                    className="sr-only"
                  >
                    Repeat reminder cadence
                  </label>
                  <select
                    id="token-alert-full-repeat-hours"
                    value={draft.alert_on_full_repeat_hours ?? 11}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        alert_on_full_repeat_hours: Number(e.target.value)
                      }))
                    }
                    disabled={disableToggles || !draft.alert_on_full}
                    className="block w-full max-w-[220px] rounded-md border border-card-border/60 bg-(--bg-secondary) px-2 py-1.5 text-sm text-primary-wh40k disabled:opacity-50"
                  >
                    {FULL_REPEAT_HOUR_OPTIONS.map((hours) => (
                      <option key={hours} value={hours}>
                        Every {hours === 168 ? 'week' : `${hours} hours`}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <span className="sr-only">Repeat reminders while still full</span>
            <Switch
              checked={fullRepeatEnabled}
              onCheckedChange={(next) =>
                setDraft((d) => ({
                  ...d,
                  alert_on_full_repeat_hours: next
                    ? (d.alert_on_full_repeat_hours ?? 11)
                    : null
                }))
              }
              disabled={disableToggles || !draft.alert_on_full}
            />
          </label>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5">
          <div className="flex items-start gap-3 min-w-0">
            <Clock className="w-4 h-4 mt-0.5 text-secondary-wh40k shrink-0" />
            <div className="min-w-0 space-y-1.5">
              <label
                htmlFor="token-alert-minutes"
                className="text-sm font-medium text-primary-wh40k block"
              >
                Alert {formatMinutesLabel(draft.alert_before_full_minutes)}{' '}
                before capping
              </label>
              <select
                id="token-alert-minutes"
                value={draft.alert_before_full_minutes}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    alert_before_full_minutes: Number(e.target.value)
                  }))
                }
                disabled={disableToggles}
                className="block w-full max-w-[220px] rounded-md border border-card-border/60 bg-(--bg-secondary) px-2 py-1.5 text-sm text-primary-wh40k disabled:opacity-50"
              >
                {MINUTE_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutesLabel(minutes)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Native <label>: the shared Switch drops aria-label. */}
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <span className="sr-only">Alert before capping</span>
            <Switch
              checked={draft.alert_before_full}
              onCheckedChange={(next) =>
                setDraft((d) => ({ ...d, alert_before_full: next }))
              }
              disabled={disableToggles}
            />
          </label>
        </div>

        {/* Separate control: capping is not a loss, burning is (12h after the cap). */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5">
          <div className="flex items-start gap-3 min-w-0">
            <Flame className="w-4 h-4 mt-0.5 text-secondary-wh40k shrink-0" />
            <div className="min-w-0 space-y-1.5">
              <label
                htmlFor="token-alert-burn-minutes"
                className="text-sm font-medium text-primary-wh40k block"
              >
                Alert {formatMinutesLabel(draft.alert_before_burn_minutes)}{' '}
                before burning a token
              </label>
              <p className="text-xs text-secondary-wh40k">
                Once you&apos;re capped you lose a token every 12 hours. This
                warns you while you can still spend it.
              </p>
              <select
                id="token-alert-burn-minutes"
                value={draft.alert_before_burn_minutes}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    alert_before_burn_minutes: Number(e.target.value)
                  }))
                }
                disabled={disableToggles || !draft.alert_before_burn}
                className="block w-full max-w-[220px] rounded-md border border-card-border/60 bg-(--bg-secondary) px-2 py-1.5 text-sm text-primary-wh40k disabled:opacity-50"
              >
                {BURN_MINUTE_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutesLabel(minutes)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <span className="sr-only">Alert before burning a token</span>
            <Switch
              checked={draft.alert_before_burn}
              onCheckedChange={(next) =>
                setDraft((d) => ({ ...d, alert_before_burn: next }))
              }
              disabled={disableToggles}
            />
          </label>
        </div>

        <ToggleRow
          label="Alert on every token gained"
          checked={draft.alert_on_token_gained}
          onCheckedChange={(next) =>
            setDraft((d) => ({ ...d, alert_on_token_gained: next }))
          }
          disabled={disableToggles}
        />
      </div>

      {/* Bombs: one parent control, sub-settings on demand. */}
      <div className="mt-3 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)]">
        <label className="flex items-center justify-between gap-4 px-3 py-2.5 cursor-pointer">
          <span className="flex items-center gap-2.5 min-w-0">
            <Bomb className="w-4 h-4 text-secondary-wh40k shrink-0" />
            <span className="min-w-0">
              <span className="text-sm font-medium text-primary-wh40k block">
                Also alert me about bombs
              </span>
              <span className="text-xs text-secondary-wh40k block">
                Raid bombs recharge every 18 hours
              </span>
            </span>
          </span>
          <Switch
            checked={showBombDetails}
            onCheckedChange={setBombsGroup}
            disabled={disableToggles}
          />
        </label>

        {showBombDetails && (
          <div className="border-t border-card-border/40 px-3 py-3 space-y-2">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm text-primary-wh40k">
                When a bomb is ready
              </span>
              <Switch
                checked={draft.alert_on_bomb_ready}
                onCheckedChange={(next) =>
                  setDraft((d) => ({ ...d, alert_on_bomb_ready: next }))
                }
                disabled={disableToggles}
              />
            </label>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <label
                  htmlFor="bomb-alert-minutes"
                  className="text-sm text-primary-wh40k block"
                >
                  {formatMinutesLabel(draft.alert_before_bomb_ready_minutes)}{' '}
                  before it&apos;s ready
                </label>
                <select
                  id="bomb-alert-minutes"
                  value={draft.alert_before_bomb_ready_minutes}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      alert_before_bomb_ready_minutes: Number(e.target.value)
                    }))
                  }
                  disabled={disableToggles || !draft.alert_before_bomb_ready}
                  className="block w-full max-w-[220px] rounded-md border border-card-border/60 bg-(--bg-secondary) px-2 py-1.5 text-sm text-primary-wh40k disabled:opacity-50"
                >
                  {BOMB_MINUTE_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatMinutesLabel(minutes)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                <span className="sr-only">Alert before the bomb is ready</span>
                <Switch
                  checked={draft.alert_before_bomb_ready}
                  onCheckedChange={(next) =>
                    setDraft((d) => ({ ...d, alert_before_bomb_ready: next }))
                  }
                  disabled={disableToggles}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Quiet hours: suppression only, never an opt-in. */}
      <div className="mt-3 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)]">
        <label className="flex items-center justify-between gap-4 px-3 py-2.5 cursor-pointer">
          <span className="flex items-center gap-2.5 min-w-0">
            <Moon className="w-4 h-4 text-secondary-wh40k shrink-0" />
            <span className="min-w-0">
              <span className="text-sm font-medium text-primary-wh40k block">
                Quiet hours
              </span>
              <span className="text-xs text-secondary-wh40k block">
                Hold DMs overnight and deliver them in the morning
              </span>
            </span>
          </span>
          <Switch
            checked={quietHoursOn}
            onCheckedChange={setQuietHours}
            disabled={disableToggles}
          />
        </label>

        {quietHoursOn && (
          <div className="border-t border-card-border/40 px-3 py-3 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
              <HourSelect
                id="quiet-hours-start"
                label="From"
                value={draft.quiet_hours_start ?? DEFAULT_QUIET_START}
                onChange={(hour) =>
                  setDraft((d) => ({ ...d, quiet_hours_start: hour }))
                }
                disabled={disableToggles}
              />
              <HourSelect
                id="quiet-hours-end"
                label="Until"
                value={draft.quiet_hours_end ?? DEFAULT_QUIET_END}
                onChange={(hour) =>
                  setDraft((d) => ({ ...d, quiet_hours_end: hour }))
                }
                disabled={disableToggles}
              />
            </div>

            <p className="text-xs text-secondary-wh40k">
              Times are in{' '}
              <span className="text-primary-wh40k">
                {draft.quiet_hours_timezone ?? 'your local timezone'}
              </span>
              . Token and bomb reminders wait until the window ends;
              gained-a-token pings are skipped entirely.
            </p>

            {/* Lead is measured from the start hour; the API and a DB CHECK require a window. */}
            <div className="flex items-start justify-between gap-4 border-t border-card-border/40 pt-2.5">
              <div className="min-w-0 space-y-1.5">
                <label
                  htmlFor="pre-quiet-minutes"
                  className="text-sm text-primary-wh40k block"
                >
                  Warn me{' '}
                  {formatMinutesLabel(draft.alert_before_quiet_hours_minutes)}{' '}
                  before quiet hours start
                </label>
                <p className="text-xs text-secondary-wh40k">
                  Only if you&apos;re capped or will cap overnight — so you can
                  spend a token before the DMs go quiet.
                </p>
                <select
                  id="pre-quiet-minutes"
                  value={draft.alert_before_quiet_hours_minutes}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      alert_before_quiet_hours_minutes: Number(e.target.value)
                    }))
                  }
                  disabled={disableToggles || !draft.alert_before_quiet_hours}
                  className="block w-full max-w-[220px] rounded-md border border-card-border/60 bg-(--bg-secondary) px-2 py-1.5 text-sm text-primary-wh40k disabled:opacity-50"
                >
                  {PRE_QUIET_MINUTE_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatMinutesLabel(minutes)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                {/* Distinct accessible name from the parent switch. */}
                <span className="sr-only">
                  Warn me before the quiet window starts
                </span>
                <Switch
                  checked={draft.alert_before_quiet_hours}
                  onCheckedChange={(next) =>
                    setDraft((d) => ({ ...d, alert_before_quiet_hours: next }))
                  }
                  disabled={disableToggles}
                />
              </label>
            </div>

            <TimeZoneMismatchNotice
              stored={draft.quiet_hours_timezone}
              disabled={disableToggles}
              onUse={(zone) =>
                setDraft((d) => ({ ...d, quiet_hours_timezone: zone }))
              }
            />

            {quietHoursInvalid && (
              <p className="text-xs text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Pick two different times — a window that starts and ends at the
                same hour is not a quiet period.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="default"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <SaveIcon className="w-3 h-3" />
          )}
          Save
        </Button>
        {error && (
          <span className="text-sm text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </span>
        )}
        {success && !error && (
          <span className="text-sm text-(--success)">{success}</span>
        )}
        {needsLink && (
          <a
            href="#connected-accounts"
            className="inline-flex px-3 py-1.5 text-xs font-semibold rounded-md bg-accent-wh40k text-(--bg-primary) hover:opacity-90 transition-colors"
          >
            Link Discord
          </a>
        )}
      </div>
    </div>
  )
}

interface HourSelectProps {
  id: string
  label: string
  value: number
  onChange: (hour: number) => void
  disabled: boolean
}

function HourSelect({ id, label, value, onChange, disabled }: HourSelectProps) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium text-secondary-wh40k block"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="block w-full rounded-md border border-card-border/60 bg-(--bg-secondary) px-2 py-1.5 text-sm text-primary-wh40k disabled:opacity-50"
      >
        {HOUR_OPTIONS.map((hour) => (
          <option key={hour} value={hour}>
            {formatHourLabel(hour)}
          </option>
        ))}
      </select>
    </div>
  )
}

/** One-click fix when the saved zone differs from the browser's; silent when they match. */
function TimeZoneMismatchNotice({
  stored,
  disabled,
  onUse
}: {
  stored: string | null
  disabled: boolean
  onUse: (zone: string) => void
}) {
  const detected = detectTimeZone()
  if (!detected || detected === stored) return null
  return (
    <button
      type="button"
      onClick={() => onUse(detected)}
      disabled={disabled}
      className="text-xs font-medium text-(--accent) hover:underline disabled:opacity-50"
    >
      Use this device&apos;s timezone ({detected})
    </button>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled: boolean
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  disabled
}: ToggleRowProps) {
  // Native <label>: the shared Switch drops aria-label.
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5 cursor-pointer">
      <span className="text-sm font-medium text-primary-wh40k">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </label>
  )
}
