'use client'

import type { ReactNode } from 'react'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { TooltipWrapper } from '@tacticus/ui-kit'
import Link from 'next/link'
import { DiscordIntegration } from '@/app/components/discord/DiscordIntegration'
import { WebhookSettings } from './WebhookSettings'
import { HeraldNotificationToggles } from './HeraldNotificationToggles'
import { RoleReconcilerSettings } from './RoleReconcilerSettings'
import {
  Key,
  Eye,
  EyeOff,
  Loader2,
  Shield,
  Lock,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  ArrowRight,
  Swords
} from 'lucide-react'
import type { UserRole } from '@tacticus/app-core/types'
import type { GuildSettingsRecord } from '@/app/lib/services/guild-settings-service'
import { SettingsSection } from './SettingsSection'
import { FormRow, SectionLabel } from '@/app/components/ui'
import { cn } from '@/app/lib/utils/cn'
import { TACTICUS_API } from '@tacticus/app-core/app-config'

export type IntegrationTone = 'success' | 'info' | 'warning' | 'muted'

export interface SummaryDetail {
  status: string
  helper: string
  tone: IntegrationTone
}

export interface ManualSyncSummary {
  lastManual: string
  lastAutomatic: string
  nextWindow: string
}

interface IntegrationSettingsPanelProps {
  userRole: UserRole
  guildConfig: GuildSettingsRecord
  proactiveTokenManagementEnabled: boolean
  apiKey: string
  onApiKeyChange: (value: string) => void
  showApiKey: boolean
  onToggleApiKeyVisibility: () => void
  validatingApiKey: boolean
  apiKeySummary: SummaryDetail
  apiKeyLastUpdatedBy: string
  apiKeyLastValidatedLabel: string
  apiKeyStoredState: string
  onValidateApiKey: () => void
  manualSyncSummary: ManualSyncSummary
  saving: boolean
  syncing: boolean
  syncCooldown: boolean
  onManualSync: () => void
  validationIndicator: ReactNode
}

export function IntegrationSettingsPanel({
  userRole,
  guildConfig,
  proactiveTokenManagementEnabled,
  apiKey,
  onApiKeyChange,
  showApiKey,
  onToggleApiKeyVisibility,
  validatingApiKey,
  apiKeySummary,
  apiKeyLastUpdatedBy,
  apiKeyLastValidatedLabel,
  apiKeyStoredState,
  onValidateApiKey,
  manualSyncSummary,
  saving,
  syncing,
  syncCooldown,
  onManualSync,
  validationIndicator
}: IntegrationSettingsPanelProps) {
  if (userRole !== 'leader') {
    return (
      <SettingsSection
        title="Integrations are leader-locked"
        description="Invite a guild leader to this panel to configure automation, API keys, and Discord webhooks."
        icon={Lock}
        tone="warning"
      >
        <p className="text-sm text-secondary-wh40k">
          Leaders can transfer authority to captains after setup if needed.
        </p>
      </SettingsSection>
    )
  }

  const canManageDiscordSystems =
    userRole === 'leader' || userRole === 'officer'
  const automationPanelShell =
    'rounded-2xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-5 md:p-6 shadow-[0_12px_28px_rgba(4,8,20,0.35)]'

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Tacticus API link"
        description="Securely connect your leader API key to power raid ingestion, token tracking, and live dashboards."
        icon={Key}
        tone="accent"
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-5">
            <FormRow
              label="Leader API key"
              htmlFor="apiKey"
              helper={
                <>
                  Paste the exact value from{' '}
                  <span className="text-(--accent) font-semibold">
                    {TACTICUS_API.ORIGIN.replace(/^https?:\/\//, '')}
                  </span>
                  . Stored keys are encrypted at rest.
                </>
              }
            >
              {({ describedBy }) => (
                <div className="relative">
                  <Input
                    id="apiKey"
                    name="tacticus-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => onApiKeyChange(event.target.value)}
                    className="pr-14 font-mono text-sm rounded-2xl"
                    placeholder="sk_live_************************"
                    disabled={validatingApiKey || saving}
                    aria-describedby={describedBy}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore="true"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                    <TooltipWrapper
                      tooltip={showApiKey ? 'Hide API key' : 'Show API key'}
                      position="left"
                    >
                      <button
                        type="button"
                        onClick={onToggleApiKeyVisibility}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-secondary-wh40k hover:text-primary-wh40k focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent) disabled:opacity-60"
                        aria-label={
                          showApiKey ? 'Hide API key' : 'Show API key'
                        }
                        disabled={validatingApiKey || saving}
                      >
                        {showApiKey ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </TooltipWrapper>
                  </div>
                </div>
              )}
            </FormRow>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={onValidateApiKey}
                disabled={saving || validatingApiKey || !apiKey.trim()}
                variant="outline"
                className="flex items-center gap-2 rounded-xl border-[color-mix(in_srgb,var(--accent)_60%,transparent)] text-(--accent) hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
              >
                {validatingApiKey ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validating…
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    Validate key
                  </>
                )}
              </Button>
              <span className="text-xs text-(--text-tertiary)">
                Validation hits the same route the automations use—great for
                quick smoke tests.
              </span>
            </div>

            {validationIndicator && (
              <div className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-4 text-sm text-primary-wh40k">
                {validationIndicator}
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] p-5 text-sm text-secondary-wh40k space-y-4">
            <SectionLabel withDivider={false}>
              <span className="inline-flex items-center gap-2">
                <Shield className="w-4 h-4 text-(--accent)" />
                Connection status
              </span>
            </SectionLabel>
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <StatusLine label="Status" value={apiKeySummary.status} bold />
              <StatusLine label="Message" value={apiKeySummary.helper} />
              <StatusLine label="Last updated by" value={apiKeyLastUpdatedBy} />
              <StatusLine
                label="Last validated"
                value={apiKeyLastValidatedLabel}
              />
              <StatusLine label="Key storage" value={apiKeyStoredState} />
            </dl>
          </aside>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Manual data sync"
        description="Kick off an on-demand sync when you need fresh battle logs before the automated cadence catches up."
        icon={RefreshCw}
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            <p className="text-sm text-secondary-wh40k">
              Manual syncs fetch both raid logs and token states. Remember
              there&apos;s a short cooldown to protect the edge function.
            </p>

            <ul className="list-disc list-inside space-y-1 rounded-2xl border border-dashed border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-4 text-xs text-(--text-tertiary)">
              <li>Requires a validated API key.</li>
              <li>Sync window typically completes within a minute.</li>
              <li>Check the audit logs after large imports.</li>
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={onManualSync}
                disabled={saving || syncing || syncCooldown}
                className="flex items-center gap-2 rounded-xl"
              >
                {syncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Trigger sync
                  </>
                )}
              </Button>
              {syncCooldown && (
                <span className="text-xs text-(--accent)">
                  Cooldown active—give it a few seconds.
                </span>
              )}
            </div>
          </div>

          <aside className="rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] p-5 text-sm text-secondary-wh40k space-y-3">
            <SectionLabel withDivider={false}>
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-(--accent)" />
                Recent runs
              </span>
            </SectionLabel>
            <dl className="grid gap-2">
              <StatusLine
                label="Manual sync"
                value={manualSyncSummary.lastManual}
              />
              <StatusLine
                label="Automatic cadence"
                value={manualSyncSummary.lastAutomatic}
              />
              <StatusLine
                label="Next window"
                value={manualSyncSummary.nextWindow}
                bold
              />
            </dl>
          </aside>
        </div>
      </SettingsSection>

      <SettingsSection
        id="discord-automations"
        title="Discord automations"
        description="Configure the briefing bot, keep webhooks healthy, and manage export pipelines for raid logs."
        icon={MessageSquare}
      >
        <div className="space-y-6">
          {canManageDiscordSystems && (
            <div className={automationPanelShell}>
              <DiscordIntegration
                guildCode={guildConfig.guild_code}
                userRole={userRole}
                clusterCode={guildConfig.cluster_code || undefined}
                className="space-y-6"
              />
            </div>
          )}

          <div className={automationPanelShell}>
            <WebhookSettings
              guildCode={guildConfig.guild_code}
              guildName={guildConfig.display_name}
              canManage={userRole === 'leader'}
              showProactiveTokenManagement={proactiveTokenManagementEnabled}
              className="space-y-4"
            />
          </div>

          {/* Herald toggles: master switch, mention-as-text, combine primes. */}
          <div className={automationPanelShell}>
            <HeraldNotificationToggles
              guildCode={guildConfig.guild_code}
              canManage={userRole === 'leader' || userRole === 'officer'}
            />
          </div>

          <div className={automationPanelShell}>
            <HeraldLinkCard />
          </div>

          {/* Auto-assign Discord meta-team roles (default off); "Resync now" works even when off. */}
          <div className={automationPanelShell}>
            <RoleReconcilerSettings
              guildCode={guildConfig.guild_code}
              canManage={userRole === 'leader' || userRole === 'officer'}
            />
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}

function HeraldLinkCard() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-2">
          <Swords className="h-5 w-5 text-yellow-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-primary-wh40k">
            Herald Role Pings
          </h3>
          <p className="text-sm text-secondary-wh40k">
            Per-boss role pings, threshold notifications, and per-side behaviour
            now live with the seasonal boss playbooks.
          </p>
        </div>
      </div>
      <Link
        href="/boss-playbooks"
        className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-md border border-teal-400/40 bg-teal-400/15 px-4 py-2 text-sm font-semibold text-teal-300 transition-colors hover:bg-teal-400/25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent) sm:self-auto"
      >
        Open Boss Playbooks
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  )
}

interface StatusLineProps {
  label: string
  value: string
  bold?: boolean
}

function StatusLine({ label, value, bold }: StatusLineProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-(--text-tertiary)">
        {label}
      </span>
      <span
        className={cn(
          'text-right text-sm',
          bold ? 'font-semibold text-primary-wh40k' : 'text-secondary-wh40k'
        )}
      >
        {value || '—'}
      </span>
    </div>
  )
}
