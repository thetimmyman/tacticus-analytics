'use client'

import { useCallback, useEffect, useState } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
import {
  DEFAULT_TOKEN_ALERT_PREFS,
  detectTimeZone,
  tokenAlertPrefsEqual,
  updateBombAlertGroup,
  updateQuietHours,
  type TokenAlertPrefs,
  type TokenAlertsResponse
} from './token-alert-settings-model'

const logger = createComponentLogger('profile.useTokenAlertSettings')

export function useTokenAlertSettings() {
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(false)
  const [linked, setLinked] = useState(false)
  const [dmBlocked, setDmBlocked] = useState(false)
  // Bot-install gate: defaults to true; only an explicit `false` shows the setup CTA.
  const [botInstalled, setBotInstalled] = useState(true)
  const [canSetupBot, setCanSetupBot] = useState(false)
  const [baseline, setBaseline] = useState(DEFAULT_TOKEN_ALERT_PREFS)
  const [draft, setDraft] = useState(DEFAULT_TOKEN_ALERT_PREFS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [needsLink, setNeedsLink] = useState(false)
  /** Keeps bomb sub-settings open mid-edit; unchecking the last toggle would collapse them. */
  const [bombsExpanded, setBombsExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/user/token-alerts')
      const data: TokenAlertsResponse = await response.json()
      if (!response.ok || !data.available) {
        setAvailable(false)
        return
      }
      setAvailable(true)
      setLinked(Boolean(data.linked))
      setDmBlocked(Boolean(data.dmBlocked))
      setBotInstalled(data.botInstalled !== false)
      setCanSetupBot(Boolean(data.canSetupBot))
      const prefs = data.prefs ?? DEFAULT_TOKEN_ALERT_PREFS
      setBaseline(prefs)
      setDraft(prefs)
    } catch (loadError) {
      logger.warn(
        `Failed to load token alert settings: ${loadError instanceof Error ? loadError.message : String(loadError)}`
      )
      setAvailable(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = !tokenAlertPrefsEqual(draft, baseline)
  const bombsEnabled =
    draft.alert_on_bomb_ready || draft.alert_before_bomb_ready
  const showBombDetails = bombsEnabled || bombsExpanded
  const quietHoursOn = draft.quiet_hours_start != null
  // Mirrors the server: start === end is rejected, so tell the user before a 400.
  const quietHoursInvalid =
    quietHoursOn && draft.quiet_hours_start === draft.quiet_hours_end
  const fullRepeatEnabled = draft.alert_on_full_repeat_hours != null

  // A PUT clears a blocked DM state, so Save stays enabled when blocked unless quiet hours are invalid.
  const canSave = (dirty || dmBlocked) && !quietHoursInvalid

  const setBombsGroup = (enabled: boolean) => {
    setBombsExpanded(enabled)
    setDraft((current) => updateBombAlertGroup(current, enabled))
  }

  const setQuietHours = (enabled: boolean) => {
    setDraft((current) => updateQuietHours(current, enabled, detectTimeZone()))
  }

  const handleSave = async () => {
    if (saving || !canSave) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    setNeedsLink(false)
    try {
      const response = await fetch('/api/user/token-alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      })
      const data: TokenAlertsResponse = await response.json()
      if (response.status === 409) {
        setNeedsLink(true)
        setError('Link your Discord account to enable token alert DMs.')
        return
      }
      if (!response.ok || !data.available) {
        setError(data.error?.message || 'Failed to save settings.')
        return
      }
      setLinked(Boolean(data.linked))
      setDmBlocked(Boolean(data.dmBlocked))
      setBotInstalled(data.botInstalled !== false)
      setCanSetupBot(Boolean(data.canSetupBot))
      const prefs: TokenAlertPrefs = data.prefs ?? draft
      setBaseline(prefs)
      setDraft(prefs)
      setSuccess('Token alert settings saved.')
    } catch (saveError) {
      logger.warn(
        `Failed to save token alert settings: ${saveError instanceof Error ? saveError.message : String(saveError)}`
      )
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return {
    loading,
    available,
    linked,
    dmBlocked,
    botInstalled,
    canSetupBot,
    draft,
    setDraft,
    saving,
    error,
    success,
    needsLink,
    dirty,
    bombsEnabled,
    showBombDetails,
    quietHoursOn,
    quietHoursInvalid,
    fullRepeatEnabled,
    canSave,
    setBombsGroup,
    setQuietHours,
    handleSave
  }
}
