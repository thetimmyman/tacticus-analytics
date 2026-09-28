'use client'

import { Switch, Input, Button, Label } from '@tacticus/ui-kit'
import {
  Bell,
  MessageSquare,
  Combine,
  Loader2,
  Save as SaveIcon,
  Bomb,
  Swords,
  RotateCcw,
  Users,
  AlignLeft
} from 'lucide-react'
import { cn } from '@/app/lib/utils/cn'
import {
  type BombCalculationMode,
  BOMB_CALCULATION_MODES,
  bombDamageRangeForGuildLevel,
  MAX_KNOWN_GUILD_LEVEL,
  MIN_KNOWN_GUILD_LEVEL
} from '@/app/lib/tacticus/bomb-damage'
import { HERALD_TOGGLE_LABEL } from './herald-notification-model'
import { useHeraldNotificationSettings } from './useHeraldNotificationSettings'

// Saved via the browser client; RLS allows the guild's officers and leaders. Optimistic with revert.

interface HeraldNotificationTogglesProps {
  guildCode: string
  canManage: boolean
  className?: string
}

const MODE_LABEL: Record<BombCalculationMode, string> = {
  worst_case: 'Worst case',
  average: 'Average',
  best_case: 'Best case'
}

const MODE_HINT: Record<BombCalculationMode, string> = {
  worst_case:
    'Assume every bomb rolls minimum damage. Alert only when even unlucky rolls finish the boss.',
  average:
    'Assume every bomb rolls midpoint damage. Earlier alerts but RNG slop can spoil a finish.',
  best_case:
    'Assume every bomb rolls maximum damage. Most aggressive — fires when only a lucky set finishes.'
}

export function HeraldNotificationToggles({
  guildCode,
  canManage,
  className
}: HeraldNotificationTogglesProps) {
  const {
    state,
    bombAlert,
    setBombAlert,
    defaultRole,
    setDefaultRole,
    savingDefaultRole,
    loading,
    savingKey,
    savingBombAlert,
    clearWebhook,
    setClearWebhook,
    loadError,
    controlsEnabled,
    bombAlertDirty,
    defaultRoleDirty,
    handleToggle,
    handleSaveBombAlert,
    handleSaveDefaultRole
  } = useHeraldNotificationSettings(guildCode, canManage)
  return (
    <div className={cn('space-y-3', className)}>
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-primary-wh40k flex items-center gap-2">
          <Bell className="w-4 h-4 text-(--accent)" />
          Notification controls
        </h3>
        <p className="text-xs text-secondary-wh40k">
          Guild-wide Herald behavior. Changes apply on the next sync — no
          redeploy required.
        </p>
      </header>

      {loadError !== null && !loading && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-primary-wh40k"
        >
          <span className="font-semibold">
            Could not load the current Herald settings
          </span>{' '}
          — the values below are defaults, not your guild&apos;s saved
          configuration, so saving has been disabled to avoid overwriting the
          real settings. Reload the page to retry. ({loadError})
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-secondary-wh40k py-3">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading current settings…
        </div>
      ) : (
        <div className="space-y-2">
          <ToggleRow
            icon={Bell}
            label={HERALD_TOGGLE_LABEL.notificationsEnabled}
            description="Off: Herald logs would-be posts but does not send to Discord. Use as a quick mute during incidents."
            checked={state.notificationsEnabled}
            onCheckedChange={(v) => handleToggle('notificationsEnabled', v)}
            disabled={!controlsEnabled || savingKey !== null}
            saving={savingKey === 'notificationsEnabled'}
          />
          <ToggleRow
            icon={Swords}
            label={HERALD_TOGGLE_LABEL.defeatAlertsEnabled}
            description="Off: Herald skips boss-defeat posts but still announces when new bosses become available. Use to quiet the channel without losing availability pings."
            checked={state.defeatAlertsEnabled}
            onCheckedChange={(v) => handleToggle('defeatAlertsEnabled', v)}
            disabled={!controlsEnabled || savingKey !== null}
            saving={savingKey === 'defeatAlertsEnabled'}
          />
          <ToggleRow
            icon={MessageSquare}
            label={HERALD_TOGGLE_LABEL.mentionRolesAsText}
            description="On: role mentions render as plain @RoleName (no actual ping). Useful for staging or quiet hours."
            checked={state.mentionRolesAsText}
            onCheckedChange={(v) => handleToggle('mentionRolesAsText', v)}
            disabled={!controlsEnabled || savingKey !== null}
            saving={savingKey === 'mentionRolesAsText'}
          />
          <ToggleRow
            icon={Combine}
            label={HERALD_TOGGLE_LABEL.combinePrimeDeaths}
            description="On: when both primes die within 60 seconds, send one combined notification instead of two."
            checked={state.combinePrimeDeaths}
            onCheckedChange={(v) => handleToggle('combinePrimeDeaths', v)}
            disabled={!controlsEnabled || savingKey !== null}
            saving={savingKey === 'combinePrimeDeaths'}
          />
          <ToggleRow
            icon={AlignLeft}
            label={HERALD_TOGGLE_LABEL.compactAvailabilityPosts}
            description="On: availability posts render as a single plain-markdown message instead of a rich embed card. Notes, tactics, videos, and links still appear — just inline in the message body. Affects availability posts only; defeat and bomb-range posts keep their embeds."
            checked={state.compactAvailabilityPosts}
            onCheckedChange={(v) => handleToggle('compactAvailabilityPosts', v)}
            disabled={!controlsEnabled || savingKey !== null}
            saving={savingKey === 'compactAvailabilityPosts'}
          />

          {/* Herald guild-wide fallback role. */}
          <div className="rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5 space-y-3">
            <div className="flex items-start gap-3">
              <Users className="w-4 h-4 mt-0.5 text-secondary-wh40k shrink-0" />
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium text-primary-wh40k">
                  Default Herald role
                </div>
                <p className="text-xs text-secondary-wh40k">
                  Pinged on Herald availability posts when no per-boss role is
                  configured AND no role-mapping rule matches. Leave blank to
                  preserve the current silent behavior. Useful for a catch-all
                  like @Announcements while the rolodex is filled in.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label
                  htmlFor="herald-default-role"
                  className="text-xs uppercase tracking-wide text-(--text-tertiary)"
                >
                  Role ID (blank = no fallback)
                </Label>
                <Input
                  id="herald-default-role"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456789012345678"
                  value={defaultRole.roleId}
                  onChange={(e) =>
                    setDefaultRole({
                      roleId: e.target.value.replace(/[^0-9]/g, '')
                    })
                  }
                  disabled={!controlsEnabled || savingDefaultRole}
                  className="font-mono"
                />
              </div>
              {controlsEnabled && (
                <div className="flex items-end">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleSaveDefaultRole}
                    disabled={!defaultRoleDirty || savingDefaultRole}
                    className="gap-1.5"
                  >
                    {savingDefaultRole ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <SaveIcon className="w-3 h-3" />
                    )}
                    Save default role
                  </Button>
                </div>
              )}
            </div>
          </div>

          <ToggleRow
            icon={Bomb}
            label={HERALD_TOGGLE_LABEL.bombAlertEnabled}
            description="On: post an alert (to a dedicated webhook below) when a boss is in range to be finished with bombs in hand. Pings @everyone or a specific role."
            checked={state.bombAlertEnabled}
            onCheckedChange={(v) => handleToggle('bombAlertEnabled', v)}
            disabled={!controlsEnabled || savingKey !== null}
            saving={savingKey === 'bombAlertEnabled'}
          />

          <ToggleRow
            icon={Users}
            label={HERALD_TOGGLE_LABEL.bombAlertPingHolders}
            description="On: ping the linked Discord accounts of players who actually have a bomb available, instead of the role / @everyone configured below. Players must link Discord from their app profile. Falls back to the role/everyone ping when no holders are linked."
            checked={state.bombAlertPingHolders}
            onCheckedChange={(v) => handleToggle('bombAlertPingHolders', v)}
            disabled={
              !controlsEnabled || savingKey !== null || !state.bombAlertEnabled
            }
            saving={savingKey === 'bombAlertPingHolders'}
          />

          {/* Per-prime kill thresholds live in each boss page's Season Configuration card. */}

          {/* Bomb-range alert configuration. */}
          <div className="rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5 space-y-3">
            <div className="flex items-start gap-3">
              <Bomb className="w-4 h-4 mt-0.5 text-secondary-wh40k shrink-0" />
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium text-primary-wh40k">
                  Bomb-range alert
                </div>
                <p className="text-xs text-secondary-wh40k">
                  Fires when a boss has low enough HP that the team can finish
                  it with bombs in hand. Bomb damage scales with your guild
                  level — current range shown below. The overkill threshold sets
                  how much margin is required — at 80%, alert only when 80% of
                  the bombs in hand can finish the boss (i.e. you have at least
                  a 25% bomb buffer). The calculation mode picks which roll the
                  alert assumes.
                </p>
                <BombDamagePreview
                  guildLevelInput={bombAlert.guildLevel}
                  mode={bombAlert.calculationMode}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="bomb-alert-overkill"
                  className="text-xs uppercase tracking-wide text-(--text-tertiary)"
                >
                  Overkill threshold (%)
                </Label>
                <Input
                  id="bomb-alert-overkill"
                  type="number"
                  inputMode="numeric"
                  min={50}
                  max={100}
                  step={5}
                  placeholder="80"
                  value={bombAlert.overkillPercent}
                  onChange={(e) =>
                    setBombAlert((b) => ({
                      ...b,
                      overkillPercent: e.target.value
                    }))
                  }
                  disabled={!controlsEnabled || savingBombAlert}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="bomb-alert-role"
                  className="text-xs uppercase tracking-wide text-(--text-tertiary)"
                >
                  Role to ping (blank = @everyone)
                </Label>
                <Input
                  id="bomb-alert-role"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456789012345678"
                  value={bombAlert.roleId}
                  onChange={(e) =>
                    setBombAlert((b) => ({
                      ...b,
                      roleId: e.target.value.replace(/[^0-9]/g, '')
                    }))
                  }
                  disabled={!controlsEnabled || savingBombAlert}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor="bomb-alert-webhook"
                    className="text-xs uppercase tracking-wide text-(--text-tertiary)"
                  >
                    Webhook URL (separate channel)
                  </Label>
                  {controlsEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        // Arming the clear is undoable until save; typing a URL also disarms it.
                        setClearWebhook((prev) => !prev)
                        setBombAlert((b) => ({ ...b, webhookUrl: '' }))
                      }}
                      className="text-[10px] uppercase tracking-wide text-(--text-tertiary) hover:text-(--accent) flex items-center gap-1"
                      disabled={savingBombAlert}
                    >
                      <RotateCcw className="w-3 h-3" />{' '}
                      {clearWebhook ? 'Undo clear' : 'Clear saved webhook'}
                    </button>
                  )}
                </div>
                <Input
                  id="bomb-alert-webhook"
                  type="text"
                  placeholder={
                    clearWebhook
                      ? 'Will be cleared on save'
                      : 'Hidden — enter a URL to replace it'
                  }
                  value={bombAlert.webhookUrl}
                  onChange={(e) => {
                    if (clearWebhook) setClearWebhook(false)
                    setBombAlert((b) => ({ ...b, webhookUrl: e.target.value }))
                  }}
                  disabled={!controlsEnabled || savingBombAlert}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-(--text-tertiary)">
                  Write-only: the saved URL is never shown here. Leave blank to
                  keep it, type a new URL to replace it, or use “Clear saved
                  webhook” to remove it.
                </p>
              </div>
            </div>

            {/* Guild level + calculation mode. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor="bomb-alert-guild-level"
                    className="text-xs uppercase tracking-wide text-(--text-tertiary)"
                  >
                    Guild level
                  </Label>
                  {bombAlert.guildLevel.length > 0 && controlsEnabled && (
                    <button
                      type="button"
                      onClick={() =>
                        setBombAlert((b) => ({ ...b, guildLevel: '' }))
                      }
                      className="text-[10px] uppercase tracking-wide text-(--text-tertiary) hover:text-(--accent) flex items-center gap-1"
                      disabled={savingBombAlert}
                    >
                      <RotateCcw className="w-3 h-3" /> Clear override
                    </button>
                  )}
                </div>
                <Input
                  id="bomb-alert-guild-level"
                  type="number"
                  inputMode="numeric"
                  min={MIN_KNOWN_GUILD_LEVEL}
                  max={100}
                  step={1}
                  placeholder={`Auto (${MIN_KNOWN_GUILD_LEVEL}-${MAX_KNOWN_GUILD_LEVEL})`}
                  value={bombAlert.guildLevel}
                  onChange={(e) =>
                    setBombAlert((b) => ({
                      ...b,
                      guildLevel: e.target.value.replace(/[^0-9]/g, '')
                    }))
                  }
                  disabled={!controlsEnabled || savingBombAlert}
                  className="font-mono"
                />
                <p className="text-[10px] text-(--text-tertiary)">
                  Auto-syncs from the server-side data feed. A value here
                  overrides until the next sync overwrites it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-(--text-tertiary)">
                  Calculation mode
                </Label>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_60%,transparent)] p-1">
                  {BOMB_CALCULATION_MODES.map((mode) => {
                    const active = bombAlert.calculationMode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          setBombAlert((b) => ({ ...b, calculationMode: mode }))
                        }
                        disabled={!controlsEnabled || savingBombAlert}
                        className={cn(
                          'rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'bg-accent-wh40k text-(--bg-primary)'
                            : 'text-secondary-wh40k hover:bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)]'
                        )}
                        aria-pressed={active}
                      >
                        {MODE_LABEL[mode]}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-(--text-tertiary)">
                  {MODE_HINT[bombAlert.calculationMode]}
                </p>
              </div>
            </div>

            {controlsEnabled && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleSaveBombAlert}
                  disabled={!bombAlertDirty || savingBombAlert}
                  className="gap-1.5"
                >
                  {savingBombAlert ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <SaveIcon className="w-3 h-3" />
                  )}
                  Save bomb-alert settings
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface ToggleRowProps {
  icon: typeof Bell
  label: string
  description: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled: boolean
  saving: boolean
}

// Preview reads the lookup directly, so level edits show before save.
function BombDamagePreview({
  guildLevelInput,
  mode
}: {
  guildLevelInput: string
  mode: BombCalculationMode
}) {
  const trimmed = guildLevelInput.trim()
  const parsed = trimmed.length > 0 ? Number.parseInt(trimmed, 10) : null
  const level =
    parsed !== null &&
    Number.isFinite(parsed) &&
    parsed >= MIN_KNOWN_GUILD_LEVEL
      ? parsed
      : null
  const range = bombDamageRangeForGuildLevel(level)
  const perBomb =
    mode === 'worst_case'
      ? range.floor
      : mode === 'best_case'
        ? range.ceil
        : Math.floor((range.floor + range.ceil) / 2)
  const levelLabel = level !== null ? `Level ${level}` : 'Unknown (default L42)'
  return (
    <p className="text-[11px] text-secondary-wh40k mt-1 font-mono">
      {levelLabel} → {formatThousands(range.floor)}–
      {formatThousands(range.ceil)} per bomb. Active mode ({MODE_LABEL[mode]})
      assumes {formatThousands(perBomb)}.
    </p>
  )
}

// Locale-agnostic formatter avoids the SSR/CSR toLocaleString mismatch.
const formatThousands = (n: number): string =>
  n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  saving
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] px-3 py-2.5">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className="w-4 h-4 mt-0.5 text-secondary-wh40k shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium text-primary-wh40k">{label}</div>
          <p className="text-xs text-secondary-wh40k">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {saving && (
          <Loader2 className="w-3 h-3 animate-spin text-(--text-tertiary)" />
        )}
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={label}
        />
      </div>
    </div>
  )
}
