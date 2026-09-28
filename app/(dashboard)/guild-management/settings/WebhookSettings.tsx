'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { useToast } from '@/app/hooks/useToast'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.settings.WebhookSettings'
)
import { cn } from '@/app/lib/utils/cn'
import { PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE } from '@/app/lib/discord/proactive-token-management'
import {
  Activity,
  Bell,
  Loader2,
  MessageSquare,
  RefreshCw,
  Shield,
  Swords,
  TestTube
} from 'lucide-react'

interface WebhookConfig {
  id?: string
  webhook_type: string
  webhook_url: string | null
  description: string | null
  enabled: boolean
  last_tested?: string | null
}

interface WebhookSettingsProps {
  guildCode: string
  guildName: string
  canManage: boolean
  showProactiveTokenManagement?: boolean
  className?: string
}

type FeedbackTone = 'success' | 'error' | 'info'

interface FeedbackMessage {
  message: string
  tone: FeedbackTone
}

const WEBHOOK_TYPES: Array<{
  type: string
  name: string
  description: string
  icon: typeof MessageSquare
  testMessage: (guildName: string) => string
}> = [
  {
    type: 'leaderboard',
    name: 'Discord Leaderboard Integration',
    description: 'Posts automatic leaderboard updates in your Discord channel',
    icon: MessageSquare,
    testMessage: (guildName) =>
      `[Test] ${guildName} leaderboard webhook is connected. Automated updates will appear here.`
  },
  {
    type: 'gr_availability',
    name: 'GR Availability',
    description: 'Publishes token availability tables with player status',
    icon: Activity,
    testMessage: (guildName) =>
      `[Test] ${guildName} token availability webhook is connected. Token summaries will display in this channel.`
  },
  {
    type: PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE,
    name: 'Proactive Token Management (Alpha)',
    description:
      'Alpha feature: proactive alerts for capped and near-cap players to prevent token waste',
    icon: Bell,
    testMessage: (guildName) =>
      `[Test] ${guildName} proactive token webhook is connected. Alpha reminders will trigger for capped and near-cap players.`
  },
  {
    type: 'boss_assignments',
    name: 'Boss Assignments',
    description: 'Delivers upcoming season boss assignments to Discord',
    icon: Shield,
    testMessage: (guildName) =>
      `[Test] ${guildName} boss assignment webhook is connected. Assignment tables will appear here when published.`
  },
  {
    type: 'diagnostic_messages',
    name: 'Diagnostic Messages',
    description:
      'Receives webhook diagnostic test messages when diagnostic posting is explicitly enabled',
    icon: TestTube,
    testMessage: (guildName) =>
      `[Test] ${guildName} diagnostic webhook is connected. Automated diagnostic test messages will post here when enabled.`
  },
  {
    type: 'herald',
    name: 'Herald Announcer',
    description:
      'Announces boss-defeat and boss-availability events to your guild channel during guild raid syncs',
    icon: Swords,
    testMessage: (guildName) =>
      `[Test] ${guildName} Herald webhook is connected. Defeat and availability notifications will post here after each guild raid sync.`
  }
]

const feedbackStyles: Record<FeedbackTone, string> = {
  success: 'text-green-400',
  error: 'text-(--accent)',
  info: 'text-secondary-wh40k'
}

/** Message and hint from the AppError envelope or legacy flat shapes; null when unusable. */
function extractServerError(
  result: unknown
): { message: string; hint?: string } | null {
  if (!result || typeof result !== 'object') return null
  const body = result as Record<string, unknown>

  const err = body.error
  if (err && typeof err === 'object') {
    const errorObject = err as { message?: unknown; metadata?: unknown }
    const message =
      typeof errorObject.message === 'string' ? errorObject.message : undefined
    let hint: string | undefined
    if (errorObject.metadata && typeof errorObject.metadata === 'object') {
      const rawHint = (errorObject.metadata as { hint?: unknown }).hint
      if (typeof rawHint === 'string') hint = rawHint
    }
    if (message) return { message, hint }
  }

  if (typeof body.error === 'string') return { message: body.error }
  if (typeof body.details === 'string') return { message: body.details }
  return null
}

export function WebhookSettings({
  guildCode,
  guildName,
  canManage,
  showProactiveTokenManagement = false,
  className
}: WebhookSettingsProps) {
  const hasMounted = useHasMounted()
  const [webhooks, setWebhooks] = useState<Record<string, WebhookConfig>>({})
  const [showUrls, setShowUrls] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [feedback, setFeedback] = useState<Record<string, FeedbackMessage>>({})
  const [loading, setLoading] = useState(true)
  const [refreshingLeaderboard, setRefreshingLeaderboard] = useState(false)
  const [leaderboardFeedback, setLeaderboardFeedback] =
    useState<FeedbackMessage | null>(null)
  const { toast } = useToast()

  const visibleWebhookTypes = useMemo(
    () =>
      WEBHOOK_TYPES.filter((entry) =>
        entry.type === PROACTIVE_TOKEN_MANAGEMENT_WEBHOOK_TYPE
          ? showProactiveTokenManagement
          : true
      ),
    [showProactiveTokenManagement]
  )

  const defaultConfig = useMemo(() => {
    const map: Record<string, WebhookConfig> = {}
    visibleWebhookTypes.forEach((entry) => {
      map[entry.type] = {
        webhook_type: entry.type,
        webhook_url: null,
        description: entry.description,
        enabled: false
      }
    })
    return map
  }, [visibleWebhookTypes])

  const loadWebhooks = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/webhooks/save?guild_code=${guildCode}`)
      if (!response.ok) {
        throw new Error('Failed to load webhook configuration')
      }

      const data: { webhooks?: WebhookConfig[] } = await response.json()
      const merged = { ...defaultConfig }

      data.webhooks?.forEach((webhook) => {
        merged[webhook.webhook_type] = {
          ...merged[webhook.webhook_type],
          ...webhook
        }
      })

      setWebhooks(merged)
    } catch (error: unknown) {
      const baseError =
        error instanceof Error ? error : new Error(String(error))
      const enhancedError = createError(
        'DATABASE_QUERY_FAILED',
        'Unable to load Discord webhook settings',
        {
          component: 'WebhookSettings',
          guildCode,
          originalError: baseError.message
        },
        baseError
      )
      logger.error({ err: enhancedError }, 'Webhook load error:')
      const formatted = formatErrorForUser(enhancedError)
      toast.error('Failed to load webhooks', formatted.displayMessage)
    } finally {
      setLoading(false)
    }
  }, [defaultConfig, guildCode, toast])

  useEffect(() => {
    loadWebhooks()
  }, [loadWebhooks])

  const setWebhookFeedback = (
    type: string,
    message: string,
    tone: FeedbackTone
  ) => {
    setFeedback((prev) => ({
      ...prev,
      [type]: { message, tone }
    }))

    setTimeout(() => {
      setFeedback((prev) => {
        const next = { ...prev }
        delete next[type]
        return next
      })
    }, 7000)
  }

  const testWebhook = async (type: string) => {
    const webhook = webhooks[type]
    if (!webhook?.webhook_url) {
      setWebhookFeedback(
        type,
        'Please enter a webhook URL before testing.',
        'info'
      )
      return
    }

    if (type === 'diagnostic_messages' && !webhook.id) {
      setWebhookFeedback(
        type,
        'Save Diagnostic Messages webhook first to enable testing.',
        'info'
      )
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
          custom_message: WEBHOOK_TYPES.find(
            (entry) => entry.type === type
          )?.testMessage(guildName)
        })
      })

      const result = await response.json().catch(() => null)

      if (response.ok && result?.success) {
        setWebhookFeedback(type, 'Webhook test sent to Discord.', 'success')
      } else {
        // The AppError envelope makes `result.error` an object.
        const serverError = extractServerError(result)
        const detail = serverError
          ? serverError.hint
            ? `${serverError.message} ${serverError.hint}`
            : serverError.message
          : 'Webhook test failed.'
        setWebhookFeedback(type, detail, 'error')
      }
    } catch (error: unknown) {
      const baseError =
        error instanceof Error ? error : new Error(String(error))
      const enhancedError = createError(
        'NETWORK_ERROR',
        'Webhook test failed',
        {
          component: 'WebhookSettings',
          webhookType: type,
          originalError: baseError.message
        },
        baseError
      )
      logger.error({ err: enhancedError }, 'Webhook test error:')
      const formatted = formatErrorForUser(enhancedError)
      setWebhookFeedback(type, formatted.displayMessage, 'error')
    } finally {
      setTesting((prev) => ({ ...prev, [type]: false }))
    }
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

      const result = await response.json().catch(() => null)
      if (!response.ok) {
        // 4xx messages are actionable, so show them verbatim; generic copy is for 5xx/network.
        const serverError = extractServerError(result)
        if (response.status >= 400 && response.status < 500 && serverError) {
          const detail = serverError.hint
            ? `${serverError.message} ${serverError.hint}`
            : serverError.message
          setWebhookFeedback(type, detail, 'error')
          return
        }
        throw new Error(
          serverError?.message || 'Failed to persist webhook settings'
        )
      }

      if (result?.webhook) {
        setWebhooks((prev) => ({
          ...prev,
          [type]: result.webhook as WebhookConfig
        }))
      }

      setWebhookFeedback(type, 'Webhook settings saved.', 'success')
    } catch (error: unknown) {
      const baseError =
        error instanceof Error ? error : new Error(String(error))
      const enhancedError = createError(
        'WEBHOOK_SAVE_FAILED',
        'Unable to save webhook configuration',
        {
          component: 'WebhookSettings',
          webhookType: type,
          guildCode,
          originalError: baseError.message
        },
        baseError
      )
      logger.error({ err: enhancedError }, 'Webhook save error:')
      const formatted = formatErrorForUser(enhancedError)
      setWebhookFeedback(type, formatted.displayMessage, 'error')
    } finally {
      setSaving((prev) => ({ ...prev, [type]: false }))
    }
  }

  const updateWebhook = (type: string, updates: Partial<WebhookConfig>) => {
    setWebhooks((prev) => {
      const existing = prev[type] ?? defaultConfig[type]
      const base: WebhookConfig = existing ?? {
        webhook_type: type,
        webhook_url: null,
        description: null,
        enabled: false,
        last_tested: null
      }

      return {
        ...prev,
        [type]: {
          ...base,
          ...updates
        }
      }
    })
  }

  const toggleUrlVisibility = (type: string) => {
    setShowUrls((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  const triggerLeaderboardRefresh = useCallback(async () => {
    setRefreshingLeaderboard(true)
    setLeaderboardFeedback(null)

    try {
      const response = await fetch('/api/discord/leaderboard-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: guildCode })
      })

      const result = await response.json()
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Leaderboard refresh failed.')
      }

      const triggerTime = result.triggered_at
        ? new Date(result.triggered_at)
        : new Date()
      let timeString = 'now'
      if (hasMounted && !isNaN(triggerTime.getTime())) {
        // eslint-disable-next-line no-restricted-syntax -- guarded by hasMounted
        timeString = triggerTime.toLocaleTimeString()
      }

      setLeaderboardFeedback({
        message: `Leaderboard refresh triggered at ${timeString}.`,
        tone: 'success'
      })
    } catch (error: unknown) {
      const baseError =
        error instanceof Error ? error : new Error(String(error))
      const enhancedError = createError(
        'WEBHOOK_LOAD_FAILED',
        'Unable to trigger leaderboard refresh',
        {
          component: 'WebhookSettings',
          guildCode,
          originalError: baseError.message
        },
        baseError
      )
      logger.error({ err: enhancedError }, 'Leaderboard refresh error:')
      const formatted = formatErrorForUser(enhancedError)
      setLeaderboardFeedback({
        message: formatted.displayMessage,
        tone: 'error'
      })
    } finally {
      setRefreshingLeaderboard(false)
    }
  }, [guildCode, hasMounted])

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-sm text-secondary-wh40k">
        <Loader2 className="h-5 w-5 animate-spin text-(--primary)" />
        Loading webhook configuration…
      </div>
    )
  }

  const containerChrome =
    className ?? 'rounded-lg border border-(--card-border) bg-(--card-bg) p-6'

  return (
    <div className={cn('space-y-4', containerChrome)}>
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-primary-wh40k">
          Discord webhooks
        </h2>
        <p className="text-sm text-secondary-wh40k">
          Configure which Discord channels receive automated updates for{' '}
          {guildName}.
        </p>
      </header>

      <div className="space-y-6">
        {visibleWebhookTypes.map((entry) => {
          const webhook = webhooks[entry.type]
          const tone = feedback[entry.type]?.tone ?? 'info'
          const Icon = entry.icon

          return (
            <section key={entry.type} className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-primary-wh40k">
                    <Icon className="h-4 w-4 text-(--accent)" />
                    <h3 className="font-medium">{entry.name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-secondary-wh40k">
                    {entry.description}
                  </p>
                </div>
                <Switch
                  checked={webhook?.enabled ?? false}
                  onCheckedChange={(enabled) =>
                    updateWebhook(entry.type, { enabled })
                  }
                  disabled={!canManage || saving[entry.type]}
                />
              </div>

              <div className="space-y-3">
                {!webhook?.enabled && (
                  <p className="text-xs text-secondary-wh40k italic">
                    This integration is currently disabled. Enable the toggle
                    and save to start posting.
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Input
                      id={`webhook-${entry.type}`}
                      type={showUrls[entry.type] ? 'text' : 'password'}
                      value={webhook?.webhook_url ?? ''}
                      onChange={(event) =>
                        updateWebhook(entry.type, {
                          webhook_url: event.target.value
                        })
                      }
                      placeholder="https://discord.com/api/webhooks/…"
                      disabled={!canManage || saving[entry.type]}
                      className="pr-24 font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="absolute right-1 top-1"
                      size="sm"
                      onClick={() => toggleUrlVisibility(entry.type)}
                    >
                      {showUrls[entry.type] ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => testWebhook(entry.type)}
                      disabled={
                        !canManage ||
                        testing[entry.type] ||
                        saving[entry.type] ||
                        !webhook?.webhook_url
                      }
                    >
                      {testing[entry.type] ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing…
                        </>
                      ) : (
                        'Send test'
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => saveWebhook(entry.type)}
                      disabled={!canManage || saving[entry.type]}
                    >
                      {saving[entry.type] ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                </div>

                {feedback[entry.type] && (
                  <p className={`text-xs ${feedbackStyles[tone]}`}>
                    {feedback[entry.type]?.message}
                  </p>
                )}

                {entry.type === 'leaderboard' && webhook?.enabled && (
                  <div className="rounded-sm bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-secondary-wh40k">
                        Need an immediate leaderboard refresh? Trigger an
                        on-demand update.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={triggerLeaderboardRefresh}
                        disabled={!canManage || refreshingLeaderboard}
                      >
                        {refreshingLeaderboard ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Triggering…
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Refresh now
                          </>
                        )}
                      </Button>
                    </div>
                    {leaderboardFeedback && (
                      <p
                        className={`text-xs ${feedbackStyles[leaderboardFeedback.tone]}`}
                      >
                        {leaderboardFeedback.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
