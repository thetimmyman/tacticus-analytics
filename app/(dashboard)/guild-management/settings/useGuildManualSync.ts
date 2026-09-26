import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { useToast } from '@/app/hooks/useToast'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import type { GuildSettingsRecord } from '@/app/lib/services/guild-settings-service'

export function useGuildManualSync(
  guildCode: string,
  setConfig: Dispatch<SetStateAction<GuildSettingsRecord>>,
  initialLastSync: string | null | undefined,
  onStart: () => void
) {
  const { toast } = useToast()
  const [syncing, setSyncing] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(
    initialLastSync ? new Date(initialLastSync) : null
  )
  const [syncCooldown, setSyncCooldown] = useState(false)
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current)
    },
    []
  )

  const handleManualSync = useCallback(async () => {
    onStart()
    setSyncing(true)
    try {
      const response = await fetch('/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: guildCode, use_stored_key: true })
      })
      const contentType = response.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json')
        ? await response.json()
        : null
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Manual sync failed'))
      }

      const runTimestampIso =
        typeof data?.timestamp === 'string'
          ? data.timestamp
          : new Date().toISOString()
      const runTimestamp = new Date(runTimestampIso)
      const battlesSynced = data?.battles_synced ?? data?.battlesSynced ?? 0
      toast.success(
        'Sync complete',
        battlesSynced > 0
          ? `Synced ${battlesSynced} battles.`
          : (data?.message ?? 'Guild sync completed.')
      )

      setLastSyncTime(runTimestamp)
      setSyncCooldown(true)
      if (cooldownRef.current) clearTimeout(cooldownRef.current)
      cooldownRef.current = setTimeout(() => {
        setSyncCooldown(false)
        cooldownRef.current = null
      }, 30000)
      setConfig((previous) => ({
        ...previous,
        updated_at: runTimestampIso,
        last_successful_sync: runTimestampIso
      }))
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to reach the manual sync endpoint. Verify the API functions are deployed and try again.'
      toast.error('Sync failed', message)
    } finally {
      setSyncing(false)
    }
  }, [guildCode, onStart, setConfig, toast])

  return { syncing, lastSyncTime, syncCooldown, handleManualSync }
}
