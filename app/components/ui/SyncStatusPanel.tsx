'use client'

import { useState, useEffect } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Loader2
} from 'lucide-react'
import { useGuildCode } from '@/app/hooks/useClusterContext'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.ui.SyncStatusPanel')
import { useToast } from '@/app/hooks/useToast'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { CORNER_STACK_SYNC_SLOT_CLASS } from '@/app/components/ui/corner-stack'
import { useCornerDock } from '@/app/providers/CornerDockContext'
import {
  useSyncFeedFreshness,
  worstStatus
} from '@/app/lib/hooks/useSyncFeedFreshness'
import type { SyncFeedStatus } from '@/app/lib/sync/feed-freshness'

const FEED_STATUS_CLASS: Record<SyncFeedStatus, string> = {
  current: 'text-(--success)',
  late: 'text-(--warning)',
  overdue: 'text-(--danger)',
  never: 'text-(--danger)'
}

/**
 * Claims come only from the server's per-feed success clock or a sync this
 * session attempted; never infer health from an attempt timestamp.
 */
interface SystemStatus {
  online: boolean
  syncing: boolean
  /** This session's manual sync outcome. `null` (not tried) is not "healthy". */
  lastAttempt: { ok: boolean; at: Date } | null
}

interface SyncStatusPanelProps {
  /** Render only the status/sync body inline, for the Tech Priest dock. */
  embedded?: boolean
}

export function SyncStatusPanel({
  embedded = false
}: SyncStatusPanelProps = {}) {
  const { toast } = useToast()
  const { dockActive } = useCornerDock()
  const [status, setStatus] = useState<SystemStatus>({
    online: true,
    syncing: false,
    lastAttempt: null
  })
  const [isExpanded, setIsExpanded] = useState(false)
  const mounted = useHasMounted()
  const [manualSyncing, setManualSyncing] = useState(false)
  const [syncCooldown, setSyncCooldown] = useState(false)
  const guildCode = useGuildCode() || null
  const { readings: feedReadings, loaded: feedLoaded } =
    useSyncFeedFreshness(mounted)
  const feedAlarm = worstStatus(feedReadings)
  const feedStopped = feedAlarm === 'overdue' || feedAlarm === 'never'
  const lastSyncFailed = status.lastAttempt?.ok === false
  // Shown only while this session's own successful run is still in cooldown.
  const justSyncedOk = status.lastAttempt?.ok === true && syncCooldown

  // Connectivity only; feed freshness comes from useSyncFeedFreshness. Do not read
  // `guild_sync_status` in the browser.
  useEffect(() => {
    setStatus((prev) => ({ ...prev, online: navigator.onLine }))

    const handleOnline = () => setStatus((prev) => ({ ...prev, online: true }))
    const handleOffline = () =>
      setStatus((prev) => ({ ...prev, online: false }))

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const getStatusColor = () => {
    if (!status.online) return 'text-(--danger)'
    if (status.syncing) return 'text-(--warning)'
    if (feedStopped) return 'text-(--danger)'
    if (lastSyncFailed || feedAlarm === 'late') return 'text-(--warning)'
    if (feedAlarm === 'current') return 'text-(--success)'
    return 'text-secondary-wh40k'
  }

  const getMainIcon = () => {
    if (!status.online)
      return <WifiOff className="w-3 h-3" aria-hidden="true" />
    if (status.syncing)
      return <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
    if (feedAlarm === 'current' && !lastSyncFailed)
      return <CheckCircle className="w-3 h-3" aria-hidden="true" />
    if (!feedLoaded) return <Wifi className="w-3 h-3" aria-hidden="true" />
    return <AlertTriangle className="w-3 h-3" aria-hidden="true" />
  }

  /** The worst true statement wins; never report healthy off an attempt timestamp. */
  const getStatusMessage = () => {
    if (!status.online) return 'DISCONNECTED'
    if (status.syncing) return 'SYNCING'
    // A stopped feed outranks a failed button press.
    if (feedAlarm === 'never') return 'NO_DATA_YET'
    if (feedAlarm === 'overdue') return 'FEED_STOPPED'
    if (lastSyncFailed) return 'SYNC_FAILED'
    if (feedAlarm === 'late') return 'FEED_BEHIND'
    if (feedAlarm === 'current') return 'OPERATIONAL'
    return 'CHECKING'
  }

  /**
   * Raw per-feed ages, deliberately not banded: each feed is judged against its
   * own cadence and "5 days" must not look like "31 minutes".
   */
  const feedFreshnessBlock = feedReadings.length > 0 && (
    <div className="col-span-2 space-y-1 border-t border-(--card-border) pt-2">
      {feedReadings.map((feed) => (
        <div
          key={feed.key}
          className="flex items-baseline justify-between gap-2 text-[11px] font-mono"
        >
          <span className="text-secondary-wh40k">{feed.label}</span>
          <span className="flex items-baseline gap-1">
            <span className={FEED_STATUS_CLASS[feed.status]}>
              {feed.ageLabel}
            </span>
            <span className="text-(--text-tertiary)">
              ({feed.cadenceLabel})
            </span>
          </span>
        </div>
      ))}
    </div>
  )

  const handleManualSync = async () => {
    if (!guildCode) {
      toast.error('Sync Failed', 'Unable to determine your guild')
      return
    }

    setManualSyncing(true)
    setStatus((prev) => ({ ...prev, syncing: true }))

    try {
      const response = await fetch('/api/guild/trigger-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          guild_code: guildCode,
          use_stored_key: true
        })
      })

      const data = await response.json()

      if (response.status === 429) {
        toast.warning(
          'Sync Cooldown',
          extractErrorMessage(data, 'Please wait before syncing again')
        )
        setSyncCooldown(true)
        setTimeout(() => setSyncCooldown(false), (data.retryAfter || 30) * 1000)
      } else if (data.success && response.ok) {
        const battlesCount = data.battles_synced || 0
        toast.success(
          'Sync Complete!',
          battlesCount > 0
            ? `Successfully synced ${battlesCount} battles`
            : 'No new battles to sync'
        )
        // Records that OUR run succeeded, not that the feed is fresh; the next
        // freshness poll decides that.
        setStatus((prev) => ({
          ...prev,
          lastAttempt: { ok: true, at: new Date() }
        }))

        setSyncCooldown(true)
        setTimeout(() => setSyncCooldown(false), 30000)
      } else {
        if (data.requiresNewKey) {
          toast.error(
            'API Key Issue',
            'Your API key could not be decrypted. Please re-enter it in settings.'
          )
        } else if (data.requiresOnboarding) {
          toast.error(
            'Setup Required',
            'Guild configuration is missing. Please complete the onboarding process.'
          )
        } else if (data.rateLimited) {
          toast.error(
            'Rate Limited',
            `Please wait ${data.retryAfter} seconds before syncing again`
          )
        } else {
          toast.error(
            'Sync Failed',
            extractErrorMessage(data, 'Unable to sync guild data')
          )
        }
        setStatus((prev) => ({
          ...prev,
          lastAttempt: { ok: false, at: new Date() }
        }))
      }
    } catch (error) {
      logger.error({ err: error }, 'Manual sync error:')
      toast.error('Sync Error', 'Connection failed. Please try again.')
      setStatus((prev) => ({
        ...prev,
        lastAttempt: { ok: false, at: new Date() }
      }))
    } finally {
      setManualSyncing(false)
      setStatus((prev) => ({ ...prev, syncing: false }))
    }
  }

  if (!mounted) {
    return null
  }

  // Grid children shared by the floating panel and the embedded dock mode.
  const syncGrid = (
    <>
      {/* Connection */}
      <div className="flex items-center gap-1">
        {status.online ? (
          <Wifi className="w-3 h-3 text-(--success)" aria-hidden="true" />
        ) : (
          <WifiOff className="w-3 h-3 text-(--danger)" aria-hidden="true" />
        )}
        <span className="text-secondary-wh40k">
          {status.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* Ingest state: whether the server sees raid data arriving. */}
      <div className="flex items-center gap-1">
        {!feedLoaded ? (
          <Loader2
            className="w-3 h-3 animate-spin text-secondary-wh40k"
            aria-hidden="true"
          />
        ) : feedAlarm === 'current' ? (
          <CheckCircle
            className="w-3 h-3 text-(--success)"
            aria-hidden="true"
          />
        ) : feedAlarm === 'late' ? (
          <AlertTriangle
            className="w-3 h-3 text-(--warning)"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="w-3 h-3 text-(--danger)"
            aria-hidden="true"
          />
        )}
        <span className="text-secondary-wh40k">
          {!feedLoaded
            ? 'INGEST_…'
            : feedAlarm === 'current'
              ? 'INGEST_OK'
              : feedAlarm === 'late'
                ? 'INGEST_LATE'
                : feedAlarm === 'never'
                  ? 'INGEST_NONE'
                  : 'INGEST_STOPPED'}
        </span>
      </div>

      {/* Manual sync: availability means we CAN sync; pressing it does not make data fresh. */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (!manualSyncing && !syncCooldown && guildCode) {
            handleManualSync()
          }
        }}
        disabled={manualSyncing || syncCooldown || !guildCode}
        className={`
          col-span-2 flex min-h-11 items-center justify-center gap-2 rounded px-3 py-2
          transition-all duration-200
          focus:outline-hidden focus:ring-2 focus:ring-(--accent)
          ${
            manualSyncing
              ? 'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-(--warning) cursor-wait'
              : justSyncedOk
                ? 'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-(--success) cursor-default'
                : syncCooldown
                  ? 'bg-(--card-bg) text-secondary-wh40k cursor-not-allowed'
                  : feedStopped
                    ? 'bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-(--danger) hover:bg-[color-mix(in_srgb,var(--danger)_30%,transparent)] cursor-pointer animate-pulse'
                    : 'bg-(--card-bg) text-secondary-wh40k hover:text-primary-wh40k cursor-pointer'
          }
        `}
        title={
          !guildCode
            ? 'No guild detected'
            : manualSyncing
              ? 'Syncing in progress...'
              : justSyncedOk
                ? 'Last manual sync completed'
                : syncCooldown
                  ? 'Please wait before syncing again'
                  : 'Click to sync guild data'
        }
      >
        {manualSyncing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span className="text-xs font-bold uppercase">SYNCING...</span>
          </>
        ) : justSyncedOk ? (
          <>
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-bold uppercase">SYNC SUCCESSFUL</span>
          </>
        ) : feedAlarm === 'never' ? (
          <>
            <AlertTriangle
              className="w-4 h-4 animate-pulse"
              aria-hidden="true"
            />
            <span className="text-xs font-bold uppercase">SYNC REQUIRED</span>
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs font-bold uppercase">CLICK TO SYNC</span>
          </>
        )}
      </button>
    </>
  )

  const statusBody = (
    <>
      <div className={`${getStatusColor()} text-xs font-mono font-bold`}>
        {getStatusMessage()}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        {syncGrid}
        {feedFreshnessBlock}
      </div>
    </>
  )

  if (embedded) {
    return <div className="space-y-2">{statusBody}</div>
  }

  // While a Tech Priest dock owns the corner, yield the floating chip.
  if (dockActive) {
    return null
  }

  return (
    <div className={CORNER_STACK_SYNC_SLOT_CLASS}>
      {!isExpanded ? (
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--card-bg)_95%,transparent)] p-2 text-left shadow-lg backdrop-blur-xs transition-all duration-300 hover:border-[color-mix(in_srgb,var(--accent)_70%,transparent)] focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:ring-offset-2 focus:ring-offset-(--bg-primary)"
          onClick={() => setIsExpanded(true)}
          aria-expanded={false}
          aria-label={`Open sync status panel: ${getStatusMessage()}`}
        >
          <span className={`${getStatusColor()} flex items-center gap-1`}>
            {getMainIcon()}
            <span className="text-xs font-mono">SYS</span>
          </span>
        </button>
      ) : (
        <section
          className="min-w-48 rounded-lg border border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--card-bg)_95%,transparent)] p-3 shadow-lg backdrop-blur-xs transition-all duration-300"
          aria-label="Sync status panel"
        >
          <div className="space-y-2">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono text-(--accent) font-bold">
                MACHINE SPIRIT
              </div>
              <button
                type="button"
                className="ml-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-secondary-wh40k transition-colors hover:text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent)"
                onClick={() => setIsExpanded(false)}
                aria-expanded={true}
                aria-label="Collapse sync status panel"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {statusBody}

            {/* Adeptus Mechanicus flavor */}
            <div className="border-t border-(--card-border) pt-2">
              <div className="text-xs text-secondary-wh40k font-mono opacity-60">
                &gt; OMNISSIAH_PROTOCOL_ACTIVE
              </div>
              <div className="text-xs text-secondary-wh40k font-mono opacity-40">
                &gt; 01001000 01000101 01001100 01010000
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
