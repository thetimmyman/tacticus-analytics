'use client'
import { useState, useEffect, useCallback } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.components.UnifiedWebhookManager'
)
import { validateDiscordWebhookUrl } from '@/app/lib/webhooks/validate-url'
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Trophy,
  Zap,
  ChevronDown,
  ChevronRight,
  Terminal
} from 'lucide-react'
import {
  WEBHOOK_TYPES,
  type WebhookConfig,
  type RawWebhook,
  type WebhookCategory
} from './webhook-manager/webhook-manager-shared'
import WebhookCard from './webhook-manager/WebhookCard'

const createWebhookConfig = (
  type: string,
  description: string,
  source?: RawWebhook | null,
  defaultClusterId?: string | null
): WebhookConfig => ({
  id: source?.id,
  webhook_type: type,
  webhook_url: source?.webhook_url ?? '',
  enabled: Boolean(source?.enabled),
  description,
  last_tested: source?.last_tested ?? undefined,
  cluster_id: source?.cluster_id ?? defaultClusterId ?? null,
  thread_id: source?.thread_id ?? null
})

const mergeEditedWebhook = (
  webhook: WebhookConfig,
  updates: Partial<WebhookConfig>,
  descriptionFallback?: string
): WebhookConfig => {
  const next: WebhookConfig = {
    ...webhook,
    ...updates
  }

  if (updates.webhook_url !== undefined) {
    next.webhook_url = updates.webhook_url ?? ''
  }

  if (updates.description !== undefined) {
    next.description = updates.description
  } else if (!next.description && descriptionFallback) {
    next.description = descriptionFallback
  }

  return next
}
interface UnifiedWebhookManagerProps {
  clusterId?: string | null
  clusterCode?: string | null
  guildCode?: string | null // Add guild code for guild-specific webhooks
  userRole?: string | null // Add user role to determine permissions
}

/**
 * Resolvers read only guild-scoped rows for these, so they always save under guild_code and
 * fetches overlay the leader's guild rows. `'herald'` falls back guild → cluster instead.
 */
const GUILD_SPECIFIC_TYPES = [
  'token_cap_notification',
  'gr_availability',
  'boss_assignments'
] as const
export default function UnifiedWebhookManager({
  clusterId,
  clusterCode,
  guildCode,
  userRole
}: UnifiedWebhookManagerProps) {
  const supabase = dbClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [editedWebhooks, setEditedWebhooks] = useState<WebhookConfig[]>([])
  const [unsavedChanges, setUnsavedChanges] = useState<Set<string>>(new Set())
  const [showUrls, setShowUrls] = useState<Record<string, boolean>>({})
  const [validationStatus, setValidationStatus] = useState<
    Record<string, 'valid' | 'invalid' | null>
  >({})
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({
    leaderboards: false,
    events: false,
    technical: false
  })
  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'object' && error !== null) {
      const errorObject = error as {
        error?: { message?: string }
        message?: unknown
      }
      if (typeof errorObject.message === 'string') {
        return errorObject.message
      }
      if (errorObject.error && typeof errorObject.error.message === 'string') {
        return errorObject.error.message
      }
    }

    if (typeof error === 'string') {
      return error
    }

    return 'Unexpected error'
  }
  const [expandedDetails, setExpandedDetails] = useState<
    Record<string, boolean>
  >({})
  const fetchWebhooks = useCallback(async () => {
    try {
      setLoading(true)
      const params =
        guildCode && userRole !== 'leader'
          ? `guild_code=${guildCode}`
          : clusterId
            ? `cluster_id=${clusterId}`
            : clusterCode
              ? `cluster_code=${clusterCode}`
              : ''

      if (!params) {
        logger.error(
          { clusterId, clusterCode, guildCode, userRole },
          'Unable to determine webhook scope params'
        )
        setMessage({
          type: 'error',
          text: 'Missing cluster or guild context for webhooks'
        })
        setLoading(false)
        return
      }

      // Cluster leaders overlay their guild's GUILD_SPECIFIC_TYPES rows so the UI shows saved state.
      const shouldFetchLeaderGuild =
        userRole === 'leader' &&
        Boolean(guildCode) &&
        !params.startsWith('guild_code=')
      const [primaryResponse, leaderGuildResponse] = await Promise.all([
        fetch(`/api/webhooks/save?${params}`),
        shouldFetchLeaderGuild
          ? fetch(`/api/webhooks/save?guild_code=${guildCode}`)
          : Promise.resolve(null)
      ])
      const data = await primaryResponse.json()

      if (!primaryResponse.ok) {
        logger.error({ err: data.error }, 'Error fetching webhooks:')
        const webhookList = Object.keys(WEBHOOK_TYPES).map((type) =>
          createWebhookConfig(
            type,
            WEBHOOK_TYPES[type as keyof typeof WEBHOOK_TYPES].description,
            null,
            clusterId ?? null
          )
        )
        setEditedWebhooks(webhookList)
        return
      }
      const existingWebhooks: RawWebhook[] = data.webhooks || []

      let leaderGuildWebhooks: RawWebhook[] = []
      if (leaderGuildResponse && leaderGuildResponse.ok) {
        const leaderData = await leaderGuildResponse.json()
        leaderGuildWebhooks = Array.isArray(leaderData?.webhooks)
          ? leaderData.webhooks
          : []
      }

      const webhookMap = new Map<string, WebhookConfig>()

      Object.entries(WEBHOOK_TYPES).forEach(([type, config]) => {
        webhookMap.set(
          type,
          createWebhookConfig(type, config.description, null, clusterId ?? null)
        )
      })

      existingWebhooks.forEach((webhook) => {
        const definition =
          WEBHOOK_TYPES[webhook.webhook_type as keyof typeof WEBHOOK_TYPES]
        if (!definition) return
        webhookMap.set(
          webhook.webhook_type,
          createWebhookConfig(
            webhook.webhook_type,
            definition.description,
            webhook,
            clusterId ?? null
          )
        )
      })

      leaderGuildWebhooks.forEach((webhook) => {
        const type = webhook.webhook_type
        if (!(GUILD_SPECIFIC_TYPES as readonly string[]).includes(type)) return
        const definition = WEBHOOK_TYPES[type as keyof typeof WEBHOOK_TYPES]
        if (!definition) return
        webhookMap.set(
          type,
          createWebhookConfig(
            type,
            definition.description,
            webhook,
            clusterId ?? null
          )
        )
      })

      setEditedWebhooks(Array.from(webhookMap.values()))
    } catch (error) {
      logger.error({ err: error }, 'Error fetching webhooks:')
      setMessage({ type: 'error', text: 'Failed to load webhook settings' })
    } finally {
      setLoading(false)
    }
  }, [clusterId, clusterCode, guildCode, userRole])

  useEffect(() => {
    fetchWebhooks()
  }, [fetchWebhooks])
  const updateWebhook = (type: string, updates: Partial<WebhookConfig>) => {
    const description =
      WEBHOOK_TYPES[type as keyof typeof WEBHOOK_TYPES]?.description
    setEditedWebhooks((prev) =>
      prev.map((w) =>
        w.webhook_type === type
          ? mergeEditedWebhook(w, updates, description)
          : w
      )
    )
    setUnsavedChanges((prev) => new Set([...prev, type]))
    if (updates.webhook_url !== undefined) {
      setValidationStatus((prev) => ({ ...prev, [type]: null }))
    }
  }
  const handleUrlChange = (type: string, url: string) => {
    updateWebhook(type, { webhook_url: url })
  }
  const handleEnabledChange = (type: string, enabled: boolean) => {
    updateWebhook(type, { enabled })
  }
  const handleTestWebhook = async (webhook: WebhookConfig) => {
    if (!webhook.webhook_url) {
      setMessage({ type: 'error', text: 'Please enter a webhook URL first' })
      return
    }
    // Catch pasted channel URLs immediately; the server enforces it too.
    const urlValidation = validateDiscordWebhookUrl(webhook.webhook_url)
    if (!urlValidation.ok) {
      const hint = 'hint' in urlValidation ? ` ${urlValidation.hint}` : ''
      setMessage({ type: 'error', text: `${urlValidation.message}${hint}` })
      return
    }
    setTesting(webhook.webhook_type)
    try {
      const config =
        WEBHOOK_TYPES[webhook.webhook_type as keyof typeof WEBHOOK_TYPES]
      // Types with specialized test messages get no custom_message.
      const specializedTypes = [
        'token_cap_notification',
        'season_summary',
        'daily_summary',
        'boss_assignments'
      ]
      const body = specializedTypes.includes(webhook.webhook_type)
        ? {
            webhook_url: webhook.webhook_url,
            webhook_type: webhook.webhook_type
          }
        : {
            webhook_url: webhook.webhook_url,
            webhook_type: webhook.webhook_type,
            custom_message: `**Test Message** - ${config.label}\n\nThis is a test notification for ${config.description}.`
          }
      const response = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const result = await response.json()
      if (result.success) {
        setMessage({
          type: 'success',
          text: `Test message sent to ${config.label} webhook!`
        })
        // Best-effort: the last-tested column may not exist yet.
        try {
          await supabase
            .from('webhook_config')
            .update({ last_tested: new Date().toISOString() })
            .eq('webhook_type', webhook.webhook_type)
        } catch {
          // The column may not exist yet.
        }
      } else {
        setMessage({
          type: 'error',
          text: `Failed to send test message: ${result.error}`
        })
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to test webhook:')
      setMessage({ type: 'error', text: 'Failed to test webhook' })
    } finally {
      setTesting(null)
    }
  }
  const saveWebhook = async (type: string) => {
    setSaving((prev) => ({ ...prev, [type]: true }))
    try {
      const webhook = editedWebhooks.find((w) => w.webhook_type === type)
      if (!webhook) return
      const isGuildWebhook =
        (GUILD_SPECIFIC_TYPES as readonly string[]).includes(
          webhook.webhook_type
        ) || userRole !== 'leader'
      const payload = {
        webhook_type: webhook.webhook_type,
        webhook_url: webhook.webhook_url.trim() || null,
        enabled: webhook.enabled,
        thread_id: webhook.thread_id?.trim() || null,
        ...(isGuildWebhook && guildCode
          ? { guild_code: guildCode }
          : { cluster_id: clusterId })
      }
      const response = await fetch('/api/webhooks/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      if (response.ok) {
        setUnsavedChanges((prev) => {
          const newSet = new Set(prev)
          newSet.delete(type)
          return newSet
        })
        setMessage({
          type: 'success',
          text: `${WEBHOOK_TYPES[type as keyof typeof WEBHOOK_TYPES].label} saved successfully!`
        })
        setTimeout(() => setMessage(null), 3000)
      } else {
        let errorMsg = 'Failed to save webhook'
        if (typeof result === 'string') {
          errorMsg = result
        } else if (result && typeof result === 'object') {
          errorMsg =
            result.error ||
            result.details ||
            result.message ||
            JSON.stringify(result) ||
            'Unknown error'
        }
        setMessage({
          type: 'error',
          text: `Failed to save ${WEBHOOK_TYPES[type as keyof typeof WEBHOOK_TYPES].label}: ${errorMsg}`
        })
      }
    } catch (error: unknown) {
      logger.error({ err: error }, 'Error saving individual webhook:')
      const errorMessage = getErrorMessage(error)
      setMessage({
        type: 'error',
        text: `Failed to save ${WEBHOOK_TYPES[type as keyof typeof WEBHOOK_TYPES].label}: ${errorMessage}`
      })
    } finally {
      setSaving((prev) => ({ ...prev, [type]: false }))
    }
  }
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }))
  }
  const toggleDetails = (webhookType: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [webhookType]: !prev[webhookType]
    }))
  }
  const CATEGORY_KEYS = ['leaderboards', 'events', 'technical'] as const

  const categories: WebhookCategory[] = [
    {
      title: 'Leaderboard Updates',
      description:
        'Hourly automated rankings for overall, boss, and prime performances',
      icon: Trophy,
      webhooks: editedWebhooks.filter(
        (w) =>
          WEBHOOK_TYPES[w.webhook_type as keyof typeof WEBHOOK_TYPES]
            ?.category === 'leaderboards'
      )
    },
    {
      title: 'Event Notifications',
      description:
        'Boss kill alerts, daily summaries, token alerts, and member join notifications',
      icon: Zap,
      webhooks: editedWebhooks.filter(
        (w) =>
          WEBHOOK_TYPES[w.webhook_type as keyof typeof WEBHOOK_TYPES]
            ?.category === 'events'
      )
    },
    {
      title: 'Technical Reports',
      description: 'System health monitoring and deployment notifications',
      icon: Terminal,
      webhooks: editedWebhooks.filter(
        (w) =>
          WEBHOOK_TYPES[w.webhook_type as keyof typeof WEBHOOK_TYPES]
            ?.category === 'technical'
      )
    }
  ].filter((category) => category.webhooks.length > 0)
  if (loading) {
    return (
      <div className="p-8 text-center text-secondary-wh40k">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading webhook settings...
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`p-4 rounded-lg border ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            {message.text}
          </div>
        </div>
      )}
      <div className="space-y-4">
        {categories.map((category, index) => {
          const categoryKey = CATEGORY_KEYS[index]
          if (!categoryKey) {
            return null
          }
          const isExpanded = expandedCategories[categoryKey] ?? false
          const Icon = category.icon
          return (
            <div
              key={categoryKey}
              className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg"
            >
              <button
                onClick={() => toggleCategory(categoryKey)}
                className="w-full p-4 flex items-center justify-between hover:bg-(--card-hover) transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-(--accent)" />
                  <div className="text-left">
                    <h3 className="text-lg font-semibold text-primary-wh40k">
                      {category.title}
                    </h3>
                    <p className="text-sm text-secondary-wh40k">
                      {category.description}
                    </p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-(--card-border) p-4 space-y-4">
                  {category.webhooks.map((webhook) => {
                    const config =
                      WEBHOOK_TYPES[
                        webhook.webhook_type as keyof typeof WEBHOOK_TYPES
                      ]
                    if (!config) {
                      return null
                    }
                    const hasUnsaved = unsavedChanges.has(webhook.webhook_type)
                    const isSaving = saving[webhook.webhook_type]
                    return (
                      <WebhookCard
                        key={webhook.webhook_type}
                        webhook={webhook}
                        config={config}
                        hasUnsaved={hasUnsaved}
                        isSaving={isSaving}
                        showUrls={showUrls}
                        setShowUrls={setShowUrls}
                        validationStatus={validationStatus}
                        testing={testing}
                        setTesting={setTesting}
                        setMessage={setMessage}
                        expandedDetails={expandedDetails}
                        toggleDetails={toggleDetails}
                        handleUrlChange={handleUrlChange}
                        handleEnabledChange={handleEnabledChange}
                        handleTestWebhook={handleTestWebhook}
                        updateWebhook={updateWebhook}
                        saveWebhook={saveWebhook}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
