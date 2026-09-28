'use client'

import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Button } from '@tacticus/ui-kit'
import { StatusLabel } from '@tacticus/ui-kit'
import { useToast } from '@/app/hooks/useToast'
import {
  Save,
  Shield,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Zap,
  Users,
  Loader2,
  Key,
  RefreshCw,
  MessageSquare,
  AlertTriangle,
  Eye
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { UserRole } from '@tacticus/app-core/types'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import type { ExplorePrivacyModes } from '@tacticus/app-core/explore-privacy'
import type { GuildSettingsRecord } from '@/app/lib/services/guild-settings-service'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { saveGuildSettingsAction } from './actions'
import { IdentitySettingsPanel } from './IdentitySettingsPanel'
import {
  IntegrationSettingsPanel,
  SummaryDetail,
  ManualSyncSummary,
  IntegrationTone
} from './IntegrationSettingsPanel'
import { ClusterSettingsPanel } from './ClusterSettingsPanel'
import { PrivacySettingsPanel } from './PrivacySettingsPanel'
import { SettingsSection } from './SettingsSection'
import { DangerZonePanel } from './DangerZonePanel'
import { PermissionsMatrixPanel } from './PermissionsMatrixPanel'
import { ClusterSettingsDialogs } from './ClusterSettingsDialogs'
import { useGuildClusterSettings } from './useGuildClusterSettings'
import { useGuildManualSync } from './useGuildManualSync'
import { useGuildApiKey } from './useGuildApiKey'
import { cn } from '@/app/lib/utils/cn'
import {
  CORNER_STACK_MOBILE_CLEARANCE_CLASS,
  CORNER_STACK_RIGHT_GUTTER_CLASS
} from '@/app/components/ui/corner-stack'
import { DEFAULT_OBFUSCATION_PERCENT } from '@tacticus/app-core/privacy'

type SectionId =
  | 'integrations'
  | 'identity'
  | 'gameplay'
  | 'permissions'
  | 'privacy'
  | 'danger'

interface SectionDefinition {
  id: SectionId
  label: string
  description: string
  icon: LucideIcon
  leaderOnly?: boolean
}

const SECTION_DEFS: SectionDefinition[] = [
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Wire up API keys, Discord hooks, and automation tooling.',
    icon: Zap,
    leaderOnly: true
  },
  {
    id: 'identity',
    label: 'Identity & Branding',
    description:
      'Control how your warband appears across the platform — branding, privacy, and cluster operations.',
    icon: Sparkles
  },
  {
    id: 'permissions',
    label: 'Role Matrix',
    description: 'Review who can access each command bridge across the guild.',
    icon: Shield
  },
  {
    id: 'privacy',
    label: 'Privacy Settings',
    description:
      'Control how your guild data appears on public Explore and leaderboard pages.',
    icon: Eye,
    leaderOnly: true
  },
  {
    id: 'danger',
    label: 'Danger Zone',
    description:
      'Irreversible operations that should only be run by guild leaders.',
    icon: AlertTriangle,
    leaderOnly: true
  }
]

interface HeroStatusCard {
  title: string
  status: string
  helper: string
  icon: LucideIcon
  tone: IntegrationTone
}

interface GuildSettingsClientProps {
  initialConfig: GuildSettingsRecord
  userRole: UserRole
  currentUserDisplayName?: string | null
  isAppAdmin?: boolean
  proactiveTokenManagementEnabled?: boolean
}

export default function GuildSettingsClient({
  initialConfig,
  userRole,
  currentUserDisplayName = null,
  isAppAdmin = false,
  proactiveTokenManagementEnabled = false
}: GuildSettingsClientProps) {
  const { toast } = useToast()

  const [config, setConfig] = useState(initialConfig)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [enabled, setEnabled] = useState(initialConfig.enabled ?? false)
  const [tagline, setTagline] = useState(initialConfig.tagline ?? '')
  const [description, setDescription] = useState(
    initialConfig.description ?? ''
  )
  const [logoUrl, setLogoUrl] = useState(initialConfig.logo_url ?? '')
  const [themePreset, setThemePreset] = useState(
    initialConfig.theme_preset ?? 'default'
  )
  const [timezone, setTimezone] = useState(initialConfig.timezone ?? 'UTC')
  const [explorePrivacyMode, setExplorePrivacyMode] =
    useState<ExplorePrivacyModes>(
      initialConfig.explore_privacy_mode ?? ['public']
    )
  const [exploreObfuscationPercent, setExploreObfuscationPercent] = useState(
    initialConfig.explore_obfuscation_percent ?? DEFAULT_OBFUSCATION_PERCENT
  )
  const [discordInvite, setDiscordInvite] = useState(
    initialConfig.social_links?.discord ?? ''
  )
  const [website, setWebsite] = useState(
    initialConfig.social_links?.website ?? ''
  )
  const [twitter, setTwitter] = useState(
    initialConfig.social_links?.twitter ?? ''
  )
  const [primaryTokenValue] = useState(
    initialConfig.primary_assignment_tokens ?? 3
  )
  const [secondaryTokenValue] = useState(
    initialConfig.secondary_assignment_tokens ?? 2
  )

  const [exploreCacheSyncing, setExploreCacheSyncing] = useState(false)
  const [deletingGuild, setDeletingGuild] = useState(false)

  const clearError = useCallback(() => setError(null), [])
  const { syncing, lastSyncTime, syncCooldown, handleManualSync } =
    useGuildManualSync(
      config.guild_code,
      setConfig,
      initialConfig.last_successful_sync,
      clearError
    )
  const {
    clusterInfo,
    loadingClusterInfo,
    showClusterWizard,
    showJoinCluster,
    openClusterWizard,
    openJoinCluster,
    closeClusterWizard,
    closeJoinCluster,
    handleClusterCreated
  } = useGuildClusterSettings(config)

  const hasMounted = useHasMounted()

  const formatMountedDateTime = useCallback(
    (date: Date, fallback = 'Recently') => {
      if (!hasMounted) return fallback
      // eslint-disable-next-line no-restricted-syntax -- guarded by hasMounted
      return date.toLocaleString()
    },
    [hasMounted]
  )

  const formatMountedTime = useCallback(
    (date: Date, fallback = 'recently') => {
      if (!hasMounted) return fallback
      // eslint-disable-next-line no-restricted-syntax -- guarded by hasMounted
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    },
    [hasMounted]
  )

  const {
    apiKey,
    setApiKey,
    showApiKey,
    toggleApiKeyVisibility,
    validatingApiKey,
    validationStatus,
    validationMessage,
    hasStoredApiKey,
    setHasStoredApiKey,
    apiKeySummary,
    apiKeyLastValidatedLabel,
    apiKeyLastUpdatedBy,
    apiKeyStoredState,
    handleValidateApiKey
  } = useGuildApiKey({
    config,
    setConfig,
    currentUserDisplayName,
    formatDateTime: formatMountedDateTime
  })

  const integrationsRef = useRef<HTMLDivElement>(null)
  const identityRef = useRef<HTMLDivElement>(null)
  const gameplayRef = useRef<HTMLDivElement>(null)
  const permissionsRef = useRef<HTMLDivElement>(null)
  const privacyRef = useRef<HTMLDivElement>(null)
  const dangerRef = useRef<HTMLDivElement>(null)

  const sectionRefs = useMemo(
    () => ({
      integrations: integrationsRef,
      identity: identityRef,
      gameplay: gameplayRef,
      permissions: permissionsRef,
      privacy: privacyRef,
      danger: dangerRef
    }),
    []
  )

  const [activeSection, setActiveSection] = useState<SectionId>('integrations')
  const canModifyDangerZone = userRole === 'leader' || userRole === 'officer'
  const canDeleteGuild = isAppAdmin

  const syncSummary = useMemo<SummaryDetail>(() => {
    if (syncing) {
      return {
        status: 'Syncing...',
        helper: 'Pulling the latest raid data right now.',
        tone: 'info'
      }
    }

    if (syncCooldown) {
      return {
        status: 'Cooling Down',
        helper: 'Wait a few seconds before triggering another sync.',
        tone: 'warning'
      }
    }

    if (lastSyncTime) {
      return {
        status: 'Manual Sync',
        helper: `Triggered at ${formatMountedTime(lastSyncTime, 'recently')}`,
        tone: 'success'
      }
    }

    if (config.updated_at) {
      return {
        status: 'Automatic Sync',
        helper: `Last automated update ${formatMountedDateTime(new Date(config.updated_at), 'recently')}`,
        tone: 'info'
      }
    }

    return {
      status: 'Not yet synced',
      helper: 'Run a manual sync after saving your API key.',
      tone: 'muted'
    }
  }, [
    syncing,
    syncCooldown,
    lastSyncTime,
    config.updated_at,
    formatMountedDateTime,
    formatMountedTime
  ])

  const webhookSummary = useMemo<SummaryDetail>(() => {
    if (config.discord_webhook_enabled) {
      return {
        status: 'Enabled',
        helper: 'Webhook automations are posting to your Discord server.',
        tone: 'success'
      }
    }

    return {
      status: 'Disabled',
      helper: 'Configure Discord webhooks to broadcast raid activity.',
      tone: 'muted'
    }
  }, [config.discord_webhook_enabled])

  const manualSyncSummary = useMemo<ManualSyncSummary>(() => {
    const lastManualDate = lastSyncTime
      ? lastSyncTime
      : config.last_successful_sync
        ? new Date(config.last_successful_sync)
        : null

    return {
      lastManual: lastManualDate
        ? formatMountedDateTime(lastManualDate, 'Recently')
        : 'Never run',
      lastAutomatic: config.updated_at
        ? formatMountedDateTime(new Date(config.updated_at), 'Recently')
        : 'Not yet recorded',
      nextWindow: !hasStoredApiKey
        ? 'Add an API key to enable manual sync'
        : syncCooldown
          ? 'Cooling down - try again in 30 seconds'
          : 'Ready for manual sync'
    }
  }, [
    lastSyncTime,
    config.last_successful_sync,
    config.updated_at,
    hasStoredApiKey,
    syncCooldown,
    formatMountedDateTime
  ])

  const clusterStatus = useMemo<{
    status: string
    helper: string
    tone: IntegrationTone
  }>(() => {
    if (config.cluster_code) {
      return {
        status: 'Linked',
        helper: `Connected to cluster ${config.cluster_code}`,
        tone: 'success'
      }
    }
    return {
      status: 'Standalone',
      helper: 'Upgrade to a cluster to share analytics across guilds.',
      tone: 'warning'
    }
  }, [config.cluster_code])

  const heroStatusCards: HeroStatusCard[] = useMemo(
    () => [
      { title: 'API Link', icon: Key, ...apiKeySummary },
      { title: 'Data Sync', icon: RefreshCw, ...syncSummary },
      { title: 'Discord Automations', icon: MessageSquare, ...webhookSummary },
      { title: 'Cluster Status', icon: Users, ...clusterStatus }
    ],
    [apiKeySummary, syncSummary, webhookSummary, clusterStatus]
  )
  const validationIndicator = useMemo(() => {
    if (!validationStatus) return null

    const icon =
      validationStatus === 'valid' ? (
        <CheckCircle className="w-5 h-5 text-emerald-300" />
      ) : validationStatus === 'invalid' ? (
        <AlertCircle className="w-5 h-5 text-(--accent)" />
      ) : (
        <Loader2 className="w-5 h-5 text-(--primary) animate-spin" />
      )

    const title =
      validationStatus === 'valid'
        ? 'API key verified successfully!'
        : validationStatus === 'invalid'
          ? 'Validation failed'
          : 'Validating API key...'

    const titleClass =
      validationStatus === 'valid'
        ? 'text-emerald-300'
        : validationStatus === 'invalid'
          ? 'text-(--accent)'
          : 'text-(--primary)'

    return (
      <div className="rounded-2xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] p-4 text-sm text-secondary-wh40k space-y-1">
        <div className="flex items-center gap-3">
          {icon}
          <p className={cn('font-semibold', titleClass)}>{title}</p>
        </div>
        {validationMessage && (
          <p className="text-sm text-secondary-wh40k">{validationMessage}</p>
        )}
      </div>
    )
  }, [validationStatus, validationMessage])

  const handleExploreCacheSync = useCallback(async () => {
    setExploreCacheSyncing(true)

    try {
      const response = await fetch('/api/explore/refresh-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: config.guild_code
        })
      })

      const data = await response
        .json()
        .catch(() => ({ error: 'Invalid response format' }))

      if (!response.ok) {
        throw new Error(
          extractErrorMessage(data, 'Failed to refresh public data cache')
        )
      }

      toast.success(
        'Public data cache refreshed',
        'Guild data updated on public Explore and leaderboard pages immediately.'
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to refresh public data cache'
      toast.error('Cache refresh failed', message)
    } finally {
      setExploreCacheSyncing(false)
    }
  }, [config.guild_code, toast])

  const handleDeleteGuild = useCallback(async () => {
    if (deletingGuild) return

    setDeletingGuild(true)
    try {
      const response = await fetch('/api/admin/guild-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_guild',
          guild_ids: [config.id]
        })
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.success) {
        const resultError = Array.isArray(data?.results)
          ? data.results.find(
              (item: Record<string, unknown>) => item?.success === false
            )
          : null
        const message =
          resultError?.error ||
          data?.details ||
          data?.error ||
          'Guild deletion failed'
        throw new Error(message)
      }

      toast.success(
        'Guild deleted',
        `${formatGuildDisplayLabel(
          {
            display_name: config.display_name,
            guild_tag: config.guild_tag,
            guild_code: config.guild_code
          },
          config.guild_code
        )} has been removed from analytics.`
      )

      setTimeout(() => {
        window.location.href = '/'
      }, 1200)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to delete guild. Please try again.'
      toast.error('Deletion failed', message)
    } finally {
      setDeletingGuild(false)
    }
  }, [
    config.id,
    config.guild_code,
    config.display_name,
    config.guild_tag,
    deletingGuild,
    toast
  ])

  const handleSave = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setSaving(true)
      setError(null)
      setSuccess(false)

      try {
        if (userRole === 'leader' && apiKey.trim()) {
          if (validationStatus !== 'valid') {
            const enhancedError = createError(
              'SETTINGS_VALIDATION_FAILED',
              'Please validate the API key before saving',
              {
                component: 'GuildSettingsClient',
                action: 'validate_api_key_before_save'
              }
            )
            const userError = formatErrorForUser(enhancedError)
            setError(userError.displayMessage)
            setSaving(false)
            return
          }

          const apiKeyResponse = await fetch('/api/guild/update-api-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guild_code: config.guild_code,
              api_key: apiKey.trim(),
              api_owner: currentUserDisplayName || 'Guild Leader'
            })
          })

          if (!apiKeyResponse.ok) {
            const apiKeyError = await apiKeyResponse.json()
            const errorMessage =
              typeof apiKeyError.error === 'string'
                ? apiKeyError.error
                : apiKeyError.error?.message || 'Failed to update API key'
            throw new Error(errorMessage)
          }

          setApiKey('')
        }

        const result = await saveGuildSettingsAction({
          guildCode: config.guild_code,
          enabled,
          tokenOffenderThreshold: config.token_offender_threshold ?? 0,
          tokenAbuserThreshold: config.token_abuser_threshold ?? 0,
          primaryAssignmentTokens: primaryTokenValue,
          secondaryAssignmentTokens: secondaryTokenValue,
          tagline: tagline || null,
          description: description || null,
          logoUrl: logoUrl || null,
          timezone,
          themePreset,
          previousThemePreset: config.theme_preset,
          socialLinks: {
            discord: discordInvite || null,
            website: website || null,
            twitter: twitter || null
          },
          explorePrivacyMode,
          exploreObfuscationPercent
        })

        if (!result.success) {
          const failureMessage =
            'error' in result ? result.error : 'Failed to update guild settings'
          throw new Error(failureMessage)
        }

        setConfig(result.data)
        setHasStoredApiKey(result.data.hasEncryptedApiKey)
        setThemePreset(result.data.theme_preset ?? 'default')
        setTagline(result.data.tagline ?? '')
        setDescription(result.data.description ?? '')
        setLogoUrl(result.data.logo_url ?? '')
        setTimezone(result.data.timezone ?? 'UTC')
        setExplorePrivacyMode(result.data.explore_privacy_mode ?? ['public'])
        setExploreObfuscationPercent(
          result.data.explore_obfuscation_percent ?? DEFAULT_OBFUSCATION_PERCENT
        )
        setDiscordInvite(result.data.social_links?.discord ?? '')
        setWebsite(result.data.social_links?.website ?? '')
        setTwitter(result.data.social_links?.twitter ?? '')

        setSuccess(true)
        setTimeout(() => setSuccess(false), 3500)

        const privacyChanged =
          JSON.stringify(initialConfig.explore_privacy_mode?.sort()) !==
          JSON.stringify(explorePrivacyMode?.sort())
        const initialObfuscationPercent =
          initialConfig.explore_obfuscation_percent ??
          DEFAULT_OBFUSCATION_PERCENT
        const obfuscationChanged =
          initialObfuscationPercent !== exploreObfuscationPercent

        if (privacyChanged || obfuscationChanged) {
          toast.success(
            'Guild settings saved',
            'Privacy settings updated and public Explore and leaderboard caches automatically refreshed!'
          )
        } else {
          toast.success(
            'Guild settings saved',
            'Your changes have been applied.'
          )
        }
      } catch (err) {
        const enhancedError = createError(
          'SETTINGS_SAVE_FAILED',
          err instanceof Error
            ? err.message
            : 'Failed to update guild settings',
          { component: 'GuildSettingsClient', action: 'save_settings' },
          err
        )
        const userError = formatErrorForUser(enhancedError)
        setError(userError.displayMessage)
        toast.error('Failed to save settings', userError.displayMessage)
      } finally {
        setSaving(false)
      }
    },
    [
      apiKey,
      config,
      currentUserDisplayName,
      description,
      discordInvite,
      enabled,
      exploreObfuscationPercent,
      explorePrivacyMode,
      initialConfig,
      logoUrl,
      primaryTokenValue,
      secondaryTokenValue,
      setApiKey,
      setHasStoredApiKey,
      tagline,
      themePreset,
      timezone,
      twitter,
      userRole,
      validationStatus,
      website,
      toast
    ]
  )

  return (
    <div className="relative min-h-screen bg-[color-mix(in_srgb,var(--bg-from)_10%,transparent)] pb-16">
      <div className="relative overflow-hidden rounded-b-[4rem] border border-[color-mix(in_srgb,var(--accent)_10%,transparent)] bg-linear-to-br from-[#120b18] via-[#1b1025] to-[#100716] shadow-[0_40px_80px_rgba(4,8,20,0.65)]">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.08]" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-6 pb-12 pt-12 sm:px-10 lg:px-12">
          <div className="flex flex-col gap-2 text-center text-primary-wh40k sm:text-left">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Guild Settings
            </h1>
            <p className="text-sm text-secondary-wh40k">
              Configure integrations, automation, and identity controls without
              the extra chrome.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {heroStatusCards.map((card) => (
              <div
                key={card.title}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl border p-4 transition-colors shadow-[0_18px_30px_rgba(4,8,20,0.45)] backdrop-blur-sm',
                  card.tone === 'success' &&
                    'border-emerald-400/40 bg-emerald-500/10',
                  card.tone === 'warning' &&
                    'border-amber-400/40 bg-amber-500/10',
                  card.tone === 'info' && 'border-sky-400/40 bg-sky-500/10',
                  card.tone === 'muted' &&
                    'border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)]'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] text-(--accent)">
                      <card.icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold text-primary-wh40k">
                      {card.title}
                    </span>
                  </div>
                  <StatusLabel
                    type={
                      card.tone === 'success'
                        ? 'success'
                        : card.tone === 'warning'
                          ? 'warning'
                          : card.tone === 'info'
                            ? 'info'
                            : 'inactive'
                    }
                  >
                    {card.status}
                  </StatusLabel>
                </div>
                <p className="text-xs text-secondary-wh40k leading-relaxed">
                  {card.helper}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {error && (
          <div className="mt-8 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-4 text-sm text-primary-wh40k shadow-[0_10px_25px_rgba(153,27,27,0.25)]">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-(--accent)" />
              <div>
                <p className="font-semibold">Save failed</p>
                <LinkifiedText
                  text={error}
                  className="block"
                  linkClassName="underline hover:no-underline"
                />
              </div>
            </div>
          </div>
        )}

        {success && (
          <div className="mt-8 rounded-2xl border border-emerald-400/50 bg-emerald-600/10 p-4 text-sm text-primary-wh40k shadow-[0_10px_25px_rgba(16,185,129,0.25)]">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-300" />
              <div>
                <p className="font-semibold">Settings updated</p>
                <p>Changes applied successfully.</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-10 flex flex-col gap-6">
          <nav
            role="tablist"
            aria-label="Settings sections"
            className="flex flex-wrap gap-2 rounded-2xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-2 shadow-[0_18px_30px_rgba(4,8,20,0.35)]"
          >
            {SECTION_DEFS.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent)'
                      : 'border border-transparent text-secondary-wh40k hover:bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] hover:text-primary-wh40k'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{section.label}</span>
                  {section.leaderOnly && (
                    <StatusLabel
                      type="warning"
                      className="text-[10px] uppercase tracking-wide"
                    >
                      Leader
                    </StatusLabel>
                  )}
                </button>
              )
            })}
          </nav>

          {/* The app-admin "Data Export" card was removed deliberately. */}

          <div>
            <form
              method="post"
              onSubmit={handleSave}
              className="space-y-8"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
            >
              {activeSection === 'integrations' && (
                <section
                  ref={sectionRefs.integrations}
                  data-section="integrations"
                >
                  <IntegrationSettingsPanel
                    userRole={userRole}
                    guildConfig={config}
                    proactiveTokenManagementEnabled={
                      proactiveTokenManagementEnabled
                    }
                    apiKey={apiKey}
                    onApiKeyChange={setApiKey}
                    showApiKey={showApiKey}
                    onToggleApiKeyVisibility={toggleApiKeyVisibility}
                    validatingApiKey={validatingApiKey}
                    apiKeySummary={apiKeySummary}
                    apiKeyLastUpdatedBy={apiKeyLastUpdatedBy}
                    apiKeyLastValidatedLabel={apiKeyLastValidatedLabel}
                    apiKeyStoredState={apiKeyStoredState}
                    onValidateApiKey={handleValidateApiKey}
                    manualSyncSummary={manualSyncSummary}
                    saving={saving}
                    syncing={syncing}
                    syncCooldown={syncCooldown}
                    onManualSync={handleManualSync}
                    validationIndicator={validationIndicator}
                  />
                </section>
              )}

              {activeSection === 'identity' && (
                <section
                  ref={sectionRefs.identity}
                  data-section="identity"
                  className="space-y-10"
                >
                  <IdentitySettingsPanel
                    guildCode={config.guild_code}
                    displayName={config.display_name}
                    tagline={tagline}
                    onTaglineChange={setTagline}
                    description={description}
                    onDescriptionChange={setDescription}
                    discordInvite={discordInvite}
                    onDiscordInviteChange={setDiscordInvite}
                    website={website}
                    onWebsiteChange={setWebsite}
                    twitter={twitter}
                    onTwitterChange={setTwitter}
                    saving={saving}
                  />
                  <ClusterSettingsPanel
                    userRole={userRole}
                    guildConfig={config}
                    loadingClusterInfo={loadingClusterInfo}
                    clusterInfo={clusterInfo}
                    onCreateCluster={openClusterWizard}
                    onJoinCluster={openJoinCluster}
                    saving={saving}
                  />
                </section>
              )}

              {/* Gameplay Settings (Assignment Calibration) hidden for now */}
              {/* GameplaySettingsPanel section disabled. */}

              {activeSection === 'permissions' && (
                <section
                  ref={sectionRefs.permissions}
                  data-section="permissions"
                >
                  <PermissionsMatrixPanel />
                </section>
              )}

              {activeSection === 'privacy' && (
                <section ref={sectionRefs.privacy} data-section="privacy">
                  <SettingsSection
                    title="Privacy Settings"
                    description="Control how your guild appears on public Explore and leaderboard pages."
                    icon={Eye}
                  >
                    <PrivacySettingsPanel
                      explorePrivacyMode={explorePrivacyMode}
                      onExplorePrivacyModeChange={setExplorePrivacyMode}
                      obfuscationPercent={exploreObfuscationPercent}
                      onObfuscationPercentChange={setExploreObfuscationPercent}
                      disabled={saving}
                      onExploreCacheSync={handleExploreCacheSync}
                      exploreCacheSyncing={exploreCacheSyncing}
                    />
                  </SettingsSection>
                </section>
              )}

              {activeSection === 'danger' && (
                <section ref={sectionRefs.danger} data-section="danger">
                  <DangerZonePanel
                    guildCode={config.guild_code}
                    enabled={enabled}
                    onEnabledChange={setEnabled}
                    saving={saving}
                    deleting={deletingGuild}
                    canModifyStatus={canModifyDangerZone}
                    canDeleteGuild={canDeleteGuild}
                    onDeleteGuild={handleDeleteGuild}
                  />
                </section>
              )}

              {/* Lifted/inset so the save bar clears the SYS chip and status pill (corner-stack.ts). */}
              <div
                className={`sticky ${CORNER_STACK_MOBILE_CLEARANCE_CLASS} z-40 sm:bottom-6 ${CORNER_STACK_RIGHT_GUTTER_CLASS}`}
              >
                <div className="flex flex-col gap-4 rounded-2xl border border-card-border/60 bg-(--bg-secondary) p-4 shadow-[0_25px_50px_rgba(4,8,20,0.55)] backdrop-blur-xs lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-sm text-secondary-wh40k">
                    Review your changes before deploying. API key updates
                    require validation first.
                  </div>
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save guild settings
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      <ClusterSettingsDialogs
        showCreate={showClusterWizard}
        showJoin={showJoinCluster}
        onCloseCreate={closeClusterWizard}
        onCloseJoin={closeJoinCluster}
        onClusterCreated={handleClusterCreated}
      />
    </div>
  )
}
