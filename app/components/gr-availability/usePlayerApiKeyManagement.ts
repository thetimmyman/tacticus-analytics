'use client'

import { useCallback, useState } from 'react'

import { extractErrorMessage, getErrorMessage } from './error-helpers'
import { createEmptyStatus, logger } from './parse'
import type { SaveStatusType, StatusState } from './types'

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
}

interface UsePlayerApiKeyManagementOptions {
  toast: ToastApi
  refreshAvailability: () => Promise<void>
  clearAvailabilityError: () => void
}

async function readJsonRecord(response: Response, invalidCode: string) {
  const contentType = response.headers.get('content-type')
  if (!contentType?.includes('application/json')) {
    const text = await response.text()
    logger.error({ err: text }, 'Non-JSON response:')
    return { error: 'Server returned invalid response', code: invalidCode }
  }

  try {
    return (await response.json()) as Record<string, unknown>
  } catch (error) {
    logger.error({ err: error }, 'Failed to parse JSON response:')
    return { error: 'Invalid response from server', code: invalidCode }
  }
}

export function usePlayerApiKeyManagement({
  toast,
  refreshAvailability,
  clearAvailabilityError
}: UsePlayerApiKeyManagementOptions) {
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [deletingKey, setDeletingKey] = useState(false)
  const [saveStatus, setSaveStatus] =
    useState<StatusState<SaveStatusType>>(createEmptyStatus<SaveStatusType>())
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(
    null
  )

  const clearStatusLater = (delay: number) => {
    setTimeout(() => setSaveStatus(createEmptyStatus()), delay)
  }

  const saveApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      setSaveStatus({ type: 'error', message: 'Please enter an API key' })
      toast.warning('Missing API Key', 'Please enter an API key')
      clearStatusLater(3000)
      return
    }

    setSavingKey(true)
    setSaveStatus({ type: 'info', message: 'Validating API key...' })
    try {
      const response = await fetch('/api/player-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      })
      const data = await readJsonRecord(response, 'INVALID_RESPONSE')

      if (!response.ok) {
        const errorMessage = extractErrorMessage(data, 'Failed to save API key')
        const errorCode = data.code ? ` (${data.code})` : ''
        if (data.code === 'NO_PLAYER_PROFILE') {
          const message =
            'Please complete your player profile setup first. Go to Profile → Edit Profile to link your Tacticus account.'
          setSaveStatus({ type: 'error', message })
          toast.error('Profile Setup Required', message)
        } else {
          const message = `${errorMessage}${errorCode}`
          setSaveStatus({ type: 'error', message })
          toast.error('API Key Error', message)
        }
        logger.error({ err: data }, 'API key save failed:')
        clearStatusLater(10000)
        return
      }

      setApiKey('')
      setHasApiKey(true)
      const successMessage = `API key saved for ${data.playerName || 'player'}! Fetching live data...`
      setSaveStatus({ type: 'success', message: successMessage })
      toast.success('API Key Saved', successMessage)

      try {
        const syncResponse = await fetch('/api/player-api-key/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        const syncData = await readJsonRecord(
          syncResponse,
          'INVALID_SYNC_RESPONSE'
        )

        if (syncResponse.ok) {
          setSaveStatus({
            type: 'success',
            message: `Live data connected! ${syncData.message || 'Your token and bomb status is now synced.'}`
          })
          setLastSuccessfulSync(new Date())
          await refreshAvailability()
        } else if (syncData.code === 'NO_PROFILE') {
          setSaveStatus({
            type: 'error',
            message:
              'API key saved but player profile not found. This should not happen - please contact support.'
          })
        } else if (syncData.code === 'DB_ERROR') {
          setSaveStatus({
            type: 'error',
            message: `API key saved but database error occurred: ${syncData.details || syncData.error}`
          })
        } else {
          setSaveStatus({
            type: 'error',
            message: `API key saved but sync failed: ${syncData.error}`
          })
        }
      } catch (error) {
        logger.error({ err: error }, 'Sync error:')
        setSaveStatus({
          type: 'error',
          message: `API key saved but couldn't sync data: ${error instanceof Error ? error.message : 'Unknown error'}`
        })
      }
      clearStatusLater(7000)
    } catch (error) {
      logger.error({ err: error }, 'Error saving API key:')
      setSaveStatus({
        type: 'error',
        message: 'Network error - please check your connection and try again'
      })
      clearStatusLater(10000)
    } finally {
      setSavingKey(false)
    }
  }, [apiKey, refreshAvailability, toast])

  const checkApiKey = useCallback(async () => {
    try {
      const response = await fetch('/api/player-api-key')
      if (!response.ok) return
      const data = (await response.json()) as { hasApiKey?: boolean }
      const nextHasApiKey = data.hasApiKey === true
      setHasApiKey(nextHasApiKey)
      // Auto-enable only on initial load.
      if (nextHasApiKey && !hasApiKey && !autoRefresh) setAutoRefresh(true)
    } catch (error) {
      logger.error({ err: error }, 'Failed to check API key status:')
    }
  }, [autoRefresh, hasApiKey])

  const deleteApiKey = useCallback(async () => {
    if (
      !confirm(
        'Are you sure you want to delete your API key? Auto-refresh will be disabled.'
      )
    ) {
      return
    }

    setDeletingKey(true)
    clearAvailabilityError()
    try {
      const response = await fetch('/api/player-api-key', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await response.json()
      if (response.ok) {
        setSaveStatus({
          type: 'success',
          message: 'API key deleted successfully'
        })
        setHasApiKey(false)
        setAutoRefresh(false)
        clearStatusLater(3000)
      } else {
        setSaveStatus({
          type: 'error',
          message: `Failed to delete API key: ${getErrorMessage(data, 'Unknown error')}`
        })
      }
    } catch (error) {
      logger.error({ err: error }, 'Delete error:')
      setSaveStatus({ type: 'error', message: 'Failed to delete API key' })
    } finally {
      setDeletingKey(false)
    }
  }, [clearAvailabilityError])

  return {
    apiKey,
    setApiKey,
    savingKey,
    hasApiKey,
    autoRefresh,
    setAutoRefresh,
    deletingKey,
    saveStatus,
    lastSuccessfulSync,
    saveApiKey,
    checkApiKey,
    deleteApiKey
  }
}
