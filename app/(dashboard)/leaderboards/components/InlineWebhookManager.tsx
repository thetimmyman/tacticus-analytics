'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { StatusLabel } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.components.InlineWebhookManager'
)
import { PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE } from '@/app/lib/discord/proactive-token-management'
import {
  MessageSquare,
  Bell,
  Shield,
  Eye,
  EyeOff,
  Loader2,
  Save,
  TestTube,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Swords
} from 'lucide-react'

interface WebhookConfig {
  id?: string
  webhook_type: string
  webhook_url: string | null
  description: string | null
  enabled: boolean
  last_tested?: string | null
}

interface InlineWebhookManagerProps {
  guildCode: string
  guildName: string
  clusterId?: string
  onClose?: () => void
  compact?: boolean
}

const WEBHOOK_CONFIGS = [
  {
    type: 'leaderboard',
    name: 'Leaderboards',
    icon: MessageSquare,
    color: 'text-blue-400',
    description: 'Automatic leaderboard updates'
  },
  {
    type: 'gr_availability',
    name: 'GR Availability',
    icon: MessageSquare,
    color: 'text-green-400',
    description: 'Token availability tables'
  },
  {
    type: PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE,
    name: 'Proactive Token Management (Alpha)',
    icon: Bell,
    color: 'text-orange-400',
    description: 'Alpha: capped and near-cap token reminders'
  },
  {
    type: 'boss_assignments',
    name: 'Assignments',
    icon: Shield,
    color: 'text-purple-400',
    description: 'Boss assignment updates'
  },
  {
    type: 'diagnostic_messages',
    name: 'Diagnostic Messages',
    icon: TestTube,
    color: 'text-sky-400',
    description: 'Webhook diagnostic test messages'
  },
  {
    type: 'herald',
    name: 'Herald Announcer',
    icon: Swords,
    color: 'text-yellow-400',
    description: 'Boss-defeat and boss-availability notifications'
  }
]

const createDefaultWebhook = (
  type: string,
  description: string | null = null
): WebhookConfig => ({
  webhook_type: type,
  webhook_url: null,
  description,
  enabled: false,
  last_tested: null
})

const mergeWebhookConfig = (
  type: string,
  base: WebhookConfig | undefined,
  updates?: Partial<WebhookConfig>,
  description?: string | null
): WebhookConfig => {
  const current = base ?? createDefaultWebhook(type, description)
  const has = (key: keyof WebhookConfig) => (updates ? key in updates : false)

  return {
    id: updates?.id ?? current.id,
    webhook_type: updates?.webhook_type ?? current.webhook_type ?? type,
    webhook_url: has('webhook_url')
      ? (updates?.webhook_url ?? null)
      : current.webhook_url,
    description:
      description ??
      (has('description')
        ? (updates?.description ?? null)
        : current.description),
    enabled: has('enabled') ? Boolean(updates?.enabled) : current.enabled,
    last_tested: has('last_tested')
      ? (updates?.last_tested ?? null)
      : (current.last_tested ?? null)
  }
}

export default function InlineWebhookManager({
  guildCode,
  guildName,
  clusterId: _clusterId,
  onClose,
  compact: _compact = false
}: InlineWebhookManagerProps) {
  void _clusterId
  void _compact
  const [webhooks, setWebhooks] = useState<Record<string, WebhookConfig>>({})
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null)
  const [showUrls, setShowUrls] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({})
  const [loading, setLoading] = useState(true)
  const [unsavedChanges, setUnsavedChanges] = useState<Set<string>>(new Set())

  const loadWebhooks = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/webhooks/save?guild_code=${guildCode}`)
      const data = await response.json()

      const webhookMap: Record<string, WebhookConfig> = {}

      WEBHOOK_CONFIGS.forEach((config) => {
        webhookMap[config.type] = createDefaultWebhook(
          config.type,
          config.description ?? null
        )
      })

      if (Array.isArray(data.webhooks)) {
        data.webhooks.forEach((webhook: Partial<WebhookConfig>) => {
          const type = webhook.webhook_type
          if (!type) return
          const description =
            WEBHOOK_CONFIGS.find((cfg) => cfg.type === type)?.description ??
            null
          webhookMap[type] = mergeWebhookConfig(
            type,
            webhookMap[type],
            webhook,
            description
          )
        })
      }

      setWebhooks(webhookMap)
    } catch (error) {
      logger.error({ err: error }, 'Failed to load webhooks:')
    } finally {
      setLoading(false)
    }
  }, [guildCode])

  useEffect(() => {
    loadWebhooks()
  }, [loadWebhooks])

  const updateWebhook = (type: string, updates: Partial<WebhookConfig>) => {
    const description =
      WEBHOOK_CONFIGS.find((cfg) => cfg.type === type)?.description ?? null
    setWebhooks((prev) => ({
      ...prev,
      [type]: mergeWebhookConfig(type, prev[type], updates, description)
    }))
    setUnsavedChanges((prev) => new Set(prev).add(type))
  }

  const saveWebhook = async (type: string) => {
    const webhook = webhooks[type]
    if (!webhook) return

    setSaving((prev) => ({ ...prev, [type]: true }))

    try {
      const response = await fetch('/api/webhooks/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: type,
          webhook_url: webhook.webhook_url?.trim() || null,
          enabled: webhook.enabled,
          guild_code: guildCode
        })
      })

      const result = await response.json()

      if (response.ok) {
        const description =
          WEBHOOK_CONFIGS.find((cfg) => cfg.type === type)?.description ?? null
        setWebhooks((prev) => ({
          ...prev,
          [type]: mergeWebhookConfig(
            type,
            prev[type],
            result.webhook,
            description
          )
        }))
        setUnsavedChanges((prev) => {
          const newSet = new Set(prev)
          newSet.delete(type)
          return newSet
        })
        setTestResults((prev) => ({
          ...prev,
          [type]: { success: true, message: 'Saved!' }
        }))
        setTimeout(
          () =>
            setTestResults((prev) => ({
              ...prev,
              [type]: { success: false, message: '' }
            })),
          3000
        )
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save webhook:')
      setTestResults((prev) => ({
        ...prev,
        [type]: { success: false, message: 'Save failed' }
      }))
    } finally {
      setSaving((prev) => ({ ...prev, [type]: false }))
    }
  }

  const testWebhook = async (type: string) => {
    const webhook = webhooks[type]
    if (!webhook?.webhook_url) {
      setTestResults((prev) => ({
        ...prev,
        [type]: { success: false, message: 'No URL set' }
      }))
      return
    }

    if (type === 'diagnostic_messages' && !webhook.id) {
      setTestResults((prev) => ({
        ...prev,
        [type]: {
          success: false,
          message: 'Save first to enable diagnostic testing'
        }
      }))
      return
    }

    setTesting((prev) => ({ ...prev, [type]: true }))

    try {
      const response = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_id: webhook.id,
          webhook_type: type,
          webhook_url: webhook.webhook_url,
          custom_message: `**Test** - ${guildName}\n\nTesting ${WEBHOOK_CONFIGS.find((c) => c.type === type)?.name} webhook.`
        })
      })

      const result = await response.json()

      setTestResults((prev) => ({
        ...prev,
        [type]: {
          success: result.success,
          message: result.success ? 'Test sent!' : 'Test failed'
        }
      }))

      setTimeout(
        () =>
          setTestResults((prev) => ({
            ...prev,
            [type]: { success: false, message: '' }
          })),
        5000
      )
    } catch (error) {
      logger.error({ err: error }, 'Failed to test webhook:')
      setTestResults((prev) => ({
        ...prev,
        [type]: { success: false, message: 'Test error' }
      }))
    } finally {
      setTesting((prev) => ({ ...prev, [type]: false }))
    }
  }

  if (loading) {
    return (
      <div className="py-4 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-(--primary)" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Compact Header */}
      <div className="flex items-center justify-between pb-2 border-b border-(--card-border)">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-(--primary)" />
          <span className="text-sm font-medium text-primary-wh40k">
            Discord Webhooks
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-secondary-wh40k hover:text-primary-wh40k transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Webhook List */}
      <div className="space-y-1">
        {WEBHOOK_CONFIGS.map((config) => {
          const webhook = webhooks[config.type]
          const isExpanded = expandedWebhook === config.type
          const hasUnsaved = unsavedChanges.has(config.type)
          const testResult = testResults[config.type]
          const isTestingNow = testing[config.type]
          const isSaving = saving[config.type]
          const Icon = config.icon

          return (
            <div
              key={config.type}
              className={`
                border border-(--card-border) rounded-lg overflow-hidden
                transition-all duration-200
                ${isExpanded ? 'bg-(--card-hover)' : 'bg-(--card-bg)'}
              `}
            >
              {/* Webhook Header Row */}
              <div
                className="flex items-center p-2 cursor-pointer hover:bg-(--card-hover) transition-colors hover:transform hover:translate-y-[-2px] hover:shadow-lg transition-all duration-200"
                onClick={() =>
                  setExpandedWebhook(isExpanded ? null : config.type)
                }
              >
                <div className="flex items-center gap-2 flex-1">
                  <Icon className={`w-4 h-4 ${config.color}`} />
                  <span className="text-sm font-medium text-primary-wh40k">
                    {config.name}
                  </span>
                  {webhook?.enabled && (
                    <StatusLabel type="success">Active</StatusLabel>
                  )}
                  {hasUnsaved && (
                    <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded-sm">
                      Unsaved
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Quick Toggle */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={webhook?.enabled || false}
                      onCheckedChange={(enabled) => {
                        updateWebhook(config.type, { enabled })
                        if (!isExpanded) {
                          // Auto-save when toggled from the collapsed state.
                          setTimeout(() => saveWebhook(config.type), 100)
                        }
                      }}
                      className="scale-75"
                    />
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-secondary-wh40k" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-secondary-wh40k" />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-(--card-border)">
                  <p className="text-xs text-secondary-wh40k pt-2">
                    {config.description}
                  </p>

                  {/* URL Input */}
                  <div className="relative">
                    <Input
                      type={showUrls[config.type] ? 'text' : 'password'}
                      value={webhook?.webhook_url || ''}
                      onChange={(e) =>
                        updateWebhook(config.type, {
                          webhook_url: e.target.value
                        })
                      }
                      placeholder="https://discord.com/api/webhooks/..."
                      className="pr-10 text-xs font-mono"
                      disabled={isSaving}
                    />
                    <button
                      onClick={() =>
                        setShowUrls((prev) => ({
                          ...prev,
                          [config.type]: !prev[config.type]
                        }))
                      }
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary-wh40k hover:text-primary-wh40k"
                      title={
                        showUrls[config.type]
                          ? 'Hide webhook URL'
                          : 'Show webhook URL'
                      }
                    >
                      {showUrls[config.type] ? (
                        <EyeOff className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => testWebhook(config.type)}
                      disabled={
                        !webhook?.webhook_url || isTestingNow || isSaving
                      }
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      title={
                        !webhook?.webhook_url
                          ? 'Enter a webhook URL first'
                          : `Send a test message to verify this ${config.name.toLowerCase()} webhook is working`
                      }
                    >
                      {isTestingNow ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <TestTube className="w-3 h-3 mr-1" />
                          Test
                        </>
                      )}
                    </Button>

                    {hasUnsaved && (
                      <Button
                        onClick={() => saveWebhook(config.type)}
                        disabled={isSaving || isTestingNow}
                        size="sm"
                        className="text-xs"
                        title={`Save changes to ${config.name.toLowerCase()} webhook configuration`}
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
                    )}

                    {/* Result Message */}
                    {testResult && testResult.message && (
                      <StatusLabel
                        type={testResult.success ? 'success' : 'error'}
                      >
                        {testResult.success && (
                          <Check className="w-3 h-3 inline mr-1" />
                        )}
                        {testResult.message}
                      </StatusLabel>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
