'use client'
import { type Dispatch, type SetStateAction } from 'react'
import { Button, ClientDate } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
import { validateDiscordWebhookUrl } from '@/app/lib/webhooks/validate-url'
import {
  Save,
  AlertTriangle,
  Loader2,
  Eye,
  EyeOff,
  TestTube,
  ChevronDown,
  ChevronRight,
  Activity,
  Hash
} from 'lucide-react'
import type {
  WebhookConfig,
  WebhookTypeDefinition
} from './webhook-manager-shared'

// Parent's component name keeps one log origin label.
const logger = createComponentLogger(
  'leaderboards.components.UnifiedWebhookManager'
)

interface WebhookCardProps {
  webhook: WebhookConfig
  config: WebhookTypeDefinition
  hasUnsaved: boolean
  isSaving: boolean | undefined
  showUrls: Record<string, boolean>
  setShowUrls: Dispatch<SetStateAction<Record<string, boolean>>>
  validationStatus: Record<string, 'valid' | 'invalid' | null>
  testing: string | null
  setTesting: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<
    SetStateAction<{ type: 'success' | 'error'; text: string } | null>
  >
  expandedDetails: Record<string, boolean>
  toggleDetails: (webhookType: string) => void
  handleUrlChange: (type: string, url: string) => void
  handleEnabledChange: (type: string, enabled: boolean) => void
  handleTestWebhook: (webhook: WebhookConfig) => Promise<void>
  updateWebhook: (type: string, updates: Partial<WebhookConfig>) => void
  saveWebhook: (type: string) => Promise<void>
}

export default function WebhookCard({
  webhook,
  config,
  hasUnsaved,
  isSaving,
  showUrls,
  setShowUrls,
  validationStatus,
  testing,
  setTesting,
  setMessage,
  expandedDetails,
  toggleDetails,
  handleUrlChange,
  handleEnabledChange,
  handleTestWebhook,
  updateWebhook,
  saveWebhook
}: WebhookCardProps) {
  const ConfigIcon = config.icon
  return (
    <div className="space-y-3 p-4 bg-card/20 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ConfigIcon className={`w-4 h-4 ${config.color}`} />
          <Label className="text-[var(--text-primary)]">{config.label}</Label>
          {hasUnsaved && (
            <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
              Unsaved
            </span>
          )}
        </div>
        <Switch
          checked={webhook.enabled}
          onCheckedChange={(enabled) =>
            handleEnabledChange(webhook.webhook_type, enabled)
          }
        />
      </div>
      {webhook.enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showUrls[webhook.webhook_type] ? 'text' : 'password'}
                value={webhook.webhook_url}
                onChange={(e) =>
                  handleUrlChange(webhook.webhook_type, e.target.value)
                }
                placeholder="https://discord.com/api/webhooks/..."
                className={`pr-10 ${
                  validationStatus[webhook.webhook_type] === 'valid'
                    ? 'border-green-500'
                    : validationStatus[webhook.webhook_type] === 'invalid'
                      ? 'border-red-500'
                      : ''
                }`}
              />
              <button
                type="button"
                onClick={() =>
                  setShowUrls((prev) => ({
                    ...prev,
                    [webhook.webhook_type]: !prev[webhook.webhook_type]
                  }))
                }
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                title={
                  showUrls[webhook.webhook_type]
                    ? 'Hide webhook URL'
                    : 'Show webhook URL'
                }
              >
                {showUrls[webhook.webhook_type] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {(() => {
              if (
                !webhook.webhook_url ||
                webhook.webhook_url.trim().length === 0
              ) {
                return null
              }
              const v = validateDiscordWebhookUrl(webhook.webhook_url)
              if (v.ok) return null
              return (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400" />
                  <div className="space-y-1">
                    <div className="font-medium">{v.message}</div>
                    {'hint' in v && <div className="opacity-90">{v.hint}</div>}
                  </div>
                </div>
              )
            })()}
            <div className="flex flex-wrap items-center gap-2">
              {webhook.enabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestWebhook(webhook)}
                  disabled={
                    testing === webhook.webhook_type || !webhook.webhook_url
                  }
                  title={
                    !webhook.webhook_url
                      ? 'Enter a webhook URL first'
                      : `Send a test message to verify this ${config.label.toLowerCase()} webhook is working`
                  }
                >
                  {testing === webhook.webhook_type ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                  Test
                </Button>
              )}
              {webhook.enabled && webhook.webhook_type === 'new_member' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setTesting(webhook.webhook_type)
                    try {
                      const response = await fetch('/api/test/new-member', {
                        method: 'POST'
                      })
                      const result = await response.json()
                      if (result.success) {
                        setMessage({
                          type: 'success',
                          text: result.message
                        })
                      } else {
                        setMessage({
                          type: 'error',
                          text: result.error
                        })
                      }
                    } catch (error) {
                      logger.error(
                        { err: error },
                        'Failed to simulate webhook notification:'
                      )
                      setMessage({
                        type: 'error',
                        text: 'Failed to send test member notification'
                      })
                    } finally {
                      setTesting(null)
                    }
                  }}
                  disabled={
                    testing === webhook.webhook_type || !webhook.webhook_url
                  }
                  title="Send a realistic new member notification to Discord using actual system data"
                >
                  {testing === webhook.webhook_type ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Activity className="w-4 h-4" />
                  )}
                  Simulate
                </Button>
              )}
            </div>
          </div>
          {/* Thread ID for forum channel support */}
          {[
            'overall_leaderboard',
            'boss_leaderboard',
            'prime_leaderboard'
          ].includes(webhook.webhook_type) && (
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
              <Input
                type="text"
                value={webhook.thread_id || ''}
                onChange={(e) =>
                  updateWebhook(webhook.webhook_type, {
                    thread_id: e.target.value || null
                  })
                }
                placeholder="Thread ID (optional, for forum channels)"
                className="flex-1 text-sm"
              />
            </div>
          )}
          {[
            'overall_leaderboard',
            'boss_leaderboard',
            'prime_leaderboard'
          ].includes(webhook.webhook_type) &&
            webhook.thread_id && (
              <p className="text-xs text-[var(--text-tertiary)]">
                Messages will be posted to forum thread {webhook.thread_id}
              </p>
            )}
          {/* Expandable details section */}
          {config.details && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => toggleDetails(webhook.webhook_type)}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                {expandedDetails[webhook.webhook_type] ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                <span>View details</span>
              </button>
              {expandedDetails[webhook.webhook_type] && (
                <div className="mt-2 p-3 bg-card/30 rounded-lg space-y-2 text-xs">
                  <div>
                    <span className="text-[var(--text-tertiary)] font-semibold">
                      Trigger:
                    </span>
                    <span className="text-[var(--text-secondary)] ml-1">
                      {config.details.trigger}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-tertiary)] font-semibold">
                      Frequency:
                    </span>
                    <span className="text-[var(--text-secondary)] ml-1">
                      {config.details.frequency}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--text-tertiary)] font-semibold">
                      Action:
                    </span>
                    <span className="text-[var(--text-secondary)] ml-1">
                      {config.details.action}
                    </span>
                  </div>
                  <div className="mt-3 p-2 bg-card/30 rounded border border-[var(--card-border)]">
                    <span className="text-[var(--text-tertiary)] font-semibold block mb-1">
                      Example Output:
                    </span>
                    <pre className="text-[var(--text-secondary)] whitespace-pre-wrap font-mono text-[10px]">
                      {config.details.example}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
          {webhook.last_tested && (
            <p className="text-xs text-[var(--text-tertiary)]">
              Last tested:{' '}
              <ClientDate date={webhook.last_tested} format="full" />
            </p>
          )}
        </div>
      )}
      {/* Save row at card level so it stays reachable when the webhook is toggled off. */}
      {hasUnsaved && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={() => saveWebhook(webhook.webhook_type)}
            disabled={isSaving}
            title={`Save changes to ${config.label.toLowerCase()} webhook configuration`}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3 h-3 mr-1" />
                Save
              </>
            )}
          </Button>
          {!webhook.enabled && (
            <span className="text-xs text-[var(--text-secondary)]">
              Click Save to confirm disabling.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
