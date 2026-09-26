'use client'

import { useEffect, useState } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { useToast } from '@/app/hooks/useToast'
import { createComponentLogger } from '@/app/lib/logging/client'
import {
  DEFAULT_BOMB_ALERT,
  DEFAULT_FALLBACK_ROLE,
  DEFAULT_HERALD_TOGGLES,
  HERALD_COLUMN_BY_KEY,
  HERALD_TOGGLE_LABEL,
  describeHeraldError,
  isBombAlertDirty,
  parseHeraldSettingsRow,
  validateBombAlert,
  validateDefaultHeraldRole,
  type BombAlertState,
  type DefaultRoleState,
  type HeraldToggleKey
} from './herald-notification-model'

const logger = createComponentLogger(
  'guild-management.settings.useHeraldNotificationSettings'
)

// PostgREST returns error: null for a zero-row UPDATE (wrong guild or RLS); require one row.
const ZERO_ROWS_MESSAGE =
  'Nothing was saved — no editable guild settings row matched this guild. Reload the page and try again.'

export function useHeraldNotificationSettings(
  guildCode: string,
  canManage: boolean
) {
  const { toast } = useToast()
  const [state, setState] = useState(DEFAULT_HERALD_TOGGLES)
  const [bombAlert, setBombAlert] = useState(DEFAULT_BOMB_ALERT)
  const [bombAlertBaseline, setBombAlertBaseline] = useState(DEFAULT_BOMB_ALERT)
  const [defaultRole, setDefaultRole] = useState(DEFAULT_FALLBACK_ROLE)
  const [defaultRoleBaseline, setDefaultRoleBaseline] = useState(
    DEFAULT_FALLBACK_ROLE
  )
  const [savingDefaultRole, setSavingDefaultRole] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<HeraldToggleKey | null>(null)
  const [savingBombAlert, setSavingBombAlert] = useState(false)
  // The webhook URL is write-only, so clearing it needs this explicit flag.
  const [clearWebhook, setClearWebhook] = useState(false)
  // Fail closed: after a load failure the inputs show DEFAULTS, and saving would
  // overwrite real config, so all controls stay disabled until a reload succeeds.
  const [loadError, setLoadError] = useState<string | null>(null)
  const controlsEnabled = canManage && loadError === null

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const { data, error } = await dbClient()
          .from('guild_config')
          .select(
            // bomb_alert_webhook_url is withheld from authenticated; selecting it fails with 42501.
            'notifications_enabled, mention_roles_as_text, combine_prime_deaths, defeat_alerts_enabled, bomb_alert_enabled, bomb_alert_overkill_threshold, bomb_alert_role_id, guild_level, bomb_alert_calculation_mode, bomb_alert_ping_holders, compact_availability_posts, herald_default_role_id'
          )
          .eq('guild_code', guildCode)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          logger.warn(`Failed to load Herald toggles: ${error.message}`)
          setState(DEFAULT_HERALD_TOGGLES)
          setBombAlert(DEFAULT_BOMB_ALERT)
          setBombAlertBaseline(DEFAULT_BOMB_ALERT)
          setLoadError(error.message)
        } else if (data) {
          const loaded = parseHeraldSettingsRow(
            data as unknown as Record<string, unknown>
          )
          setState(loaded.toggles)
          setBombAlert(loaded.bombAlert)
          setBombAlertBaseline(loaded.bombAlert)
          setDefaultRole(loaded.defaultRole)
          setDefaultRoleBaseline(loaded.defaultRole)
        }
        // No visible row is not a failure: render defaults (an UPDATE surfaces the zero-row error).
      } catch (error) {
        if (!cancelled) {
          const message = describeHeraldError(error)
          logger.warn(`Unexpected error loading Herald toggles: ${message}`)
          setState(DEFAULT_HERALD_TOGGLES)
          setLoadError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (guildCode) void load()
    return () => {
      cancelled = true
    }
  }, [guildCode])

  const handleToggle = async (key: HeraldToggleKey, next: boolean) => {
    if (!controlsEnabled || savingKey) return
    const previous = state[key]
    setState((current) => ({ ...current, [key]: next }))
    setSavingKey(key)
    try {
      const { error, count } = await dbClient()
        .from('guild_config')
        .update({ [HERALD_COLUMN_BY_KEY[key]]: next }, { count: 'exact' })
        .eq('guild_code', guildCode)
      if (error) throw error
      if (count !== 1) throw new Error(ZERO_ROWS_MESSAGE)
      setClearWebhook(false)
      toast.success('Notification setting saved', HERALD_TOGGLE_LABEL[key])
    } catch (error) {
      const message = describeHeraldError(error)
      logger.warn(`Failed to save Herald toggle ${key}: ${message}`)
      setState((current) => ({ ...current, [key]: previous }))
      toast.error('Could not save setting', message)
    } finally {
      setSavingKey(null)
    }
  }

  const handleSaveBombAlert = async () => {
    if (!controlsEnabled || savingBombAlert) return
    const validation = validateBombAlert(
      bombAlert,
      clearWebhook,
      new Date().toISOString()
    )
    if (!validation.ok) {
      toast.error(validation.title, validation.message)
      return
    }
    setSavingBombAlert(true)
    try {
      const { error, count } = await dbClient()
        .from('guild_config')
        .update(validation.value, { count: 'exact' })
        .eq('guild_code', guildCode)
      if (error) throw error
      if (count !== 1) throw new Error(ZERO_ROWS_MESSAGE)
      const saved: BombAlertState = { ...bombAlert, webhookUrl: '' }
      setBombAlert(saved)
      setBombAlertBaseline(saved)
      const replacedWebhook = bombAlert.webhookUrl.trim().length > 0
      setClearWebhook(false)
      toast.success(
        'Bomb-alert settings saved',
        replacedWebhook
          ? 'Webhook URL replaced. Herald will fire a bomb-range alert when a boss is within reach.'
          : clearWebhook
            ? 'Webhook URL cleared — no alerts will fire until one is set.'
            : 'Stored webhook URL kept (value is hidden from the browser).'
      )
    } catch (error) {
      const message = describeHeraldError(error)
      logger.warn(`Failed to save bomb-alert settings: ${message}`)
      toast.error('Could not save bomb-alert settings', message)
    } finally {
      setSavingBombAlert(false)
    }
  }

  // Empty clears the fallback role; otherwise it must be a snowflake.
  const handleSaveDefaultRole = async () => {
    if (!controlsEnabled || savingDefaultRole) return
    const validation = validateDefaultHeraldRole(defaultRole.roleId)
    if (!validation.ok) {
      toast.error(validation.title, validation.message)
      return
    }
    setSavingDefaultRole(true)
    try {
      const { error, count } = await dbClient()
        .from('guild_config')
        .update(
          { herald_default_role_id: validation.value },
          { count: 'exact' }
        )
        .eq('guild_code', guildCode)
      if (error) throw error
      if (count !== 1) throw new Error(ZERO_ROWS_MESSAGE)
      // Any successful save disarms a pending clear, or the next bomb-alert save would wipe the webhook.
      setClearWebhook(false)
      const saved: DefaultRoleState = {
        roleId: validation.value ?? ''
      }
      setDefaultRole(saved)
      setDefaultRoleBaseline(saved)
      toast.success(
        'Default Herald role saved',
        validation.value === null
          ? 'No fallback configured — Herald posts without a matching role will not ping.'
          : 'Herald will fall back to this role when no per-boss role is configured.'
      )
    } catch (error) {
      const message = describeHeraldError(error)
      logger.warn(`Failed to save default Herald role: ${message}`)
      toast.error('Could not save default Herald role', message)
    } finally {
      setSavingDefaultRole(false)
    }
  }

  return {
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
    bombAlertDirty: isBombAlertDirty(
      bombAlert,
      bombAlertBaseline,
      clearWebhook
    ),
    defaultRoleDirty: defaultRole.roleId !== defaultRoleBaseline.roleId,
    handleToggle,
    handleSaveBombAlert,
    handleSaveDefaultRole
  }
}
