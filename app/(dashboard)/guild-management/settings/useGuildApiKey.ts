import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { useToast } from '@/app/hooks/useToast'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import type { GuildSettingsRecord } from '@/app/lib/services/guild-settings-service'
import { markApiKeyValidatedAction } from './actions'
import type { SummaryDetail } from './IntegrationSettingsPanel'

export type ApiKeyValidationStatus = 'valid' | 'invalid' | 'checking' | null

interface UseGuildApiKeyOptions {
  config: GuildSettingsRecord
  setConfig: Dispatch<SetStateAction<GuildSettingsRecord>>
  currentUserDisplayName: string | null
  formatDateTime: (date: Date, fallback?: string) => string
}

export function useGuildApiKey({
  config,
  setConfig,
  currentUserDisplayName,
  formatDateTime
}: UseGuildApiKeyOptions) {
  const { toast } = useToast()
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [validatingApiKey, setValidatingApiKey] = useState(false)
  const [validationStatus, setValidationStatus] =
    useState<ApiKeyValidationStatus>(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  )
  const [hasStoredApiKey, setHasStoredApiKey] = useState(
    config.hasEncryptedApiKey
  )

  useEffect(() => {
    // Only mark 'valid' when the database confirms it and nothing newer exists.
    if (
      config.api_key_is_valid === true &&
      validationStatus !== 'valid' &&
      validationStatus !== 'checking'
    ) {
      setValidationStatus('valid')
      setValidationMessage('API key is valid and working!')
    } else if (
      config.api_key_is_valid === false &&
      validationStatus !== 'invalid' &&
      validationStatus !== 'checking'
    ) {
      setValidationStatus('invalid')
      setValidationMessage(
        'Previously failed validation - please validate again'
      )
    }
  }, [config.api_key_is_valid, validationStatus])

  const apiKeySummary = useMemo<SummaryDetail>(() => {
    if (validationStatus === 'valid') {
      return {
        status: 'Connected',
        helper: validationMessage ?? 'Leader API key verified successfully.',
        tone: 'success'
      }
    }
    if (validationStatus === 'invalid') {
      return {
        status: 'Needs Attention',
        helper: validationMessage ?? 'The supplied key failed verification.',
        tone: 'warning'
      }
    }
    if (validationStatus === 'checking') {
      return {
        status: 'Validating...',
        helper: 'Testing the key against the Tacticus service.',
        tone: 'info'
      }
    }
    if (hasStoredApiKey) {
      if (config.api_key_is_valid === false) {
        return {
          status: 'Invalid',
          helper: 'Last verification failed. Replace the key to restore sync.',
          tone: 'warning'
        }
      }
      return {
        status: 'Connected',
        helper: config.api_key_last_validated
          ? `Last checked ${formatDateTime(new Date(config.api_key_last_validated), 'recently')}`
          : 'Stored key present; validate to confirm connectivity.',
        tone: 'success'
      }
    }
    return {
      status: 'Missing',
      helper: 'Add your leader API key to enable automations.',
      tone: 'muted'
    }
  }, [
    config.api_key_is_valid,
    config.api_key_last_validated,
    formatDateTime,
    hasStoredApiKey,
    validationMessage,
    validationStatus
  ])

  const apiKeyLastValidatedLabel = useMemo(() => {
    if (validationStatus === 'valid') return 'Just verified'
    if (validationStatus === 'invalid') return 'Validation failed'
    if (config.api_key_last_validated) {
      return formatDateTime(new Date(config.api_key_last_validated), 'Recently')
    }
    return 'Not yet validated'
  }, [config.api_key_last_validated, formatDateTime, validationStatus])

  const apiKeyLastUpdatedBy = useMemo(() => {
    if (validationStatus === 'valid' && currentUserDisplayName) {
      return currentUserDisplayName
    }
    return config.API_Owner || 'Not recorded'
  }, [config.API_Owner, currentUserDisplayName, validationStatus])

  const apiKeyStoredState = useMemo(() => {
    if (!hasStoredApiKey) return 'No key stored'
    if (config.api_key_is_valid === true)
      return 'Stored key previously validated'
    if (config.api_key_is_valid === false) return 'Stored key failed validation'
    return 'Stored key unverified'
  }, [config.api_key_is_valid, hasStoredApiKey])

  const handleValidateApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      setValidationStatus('invalid')
      setValidationMessage('Please enter an API key')
      return
    }

    setValidatingApiKey(true)
    setValidationStatus('checking')
    setValidationMessage('Validating API key...')
    try {
      const response = await fetch('/api/guild/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() })
      })
      const data = await response.json()
      if (response.ok && data.success) {
        const result = await markApiKeyValidatedAction(config.guild_code)
        if (!result.success) {
          const message =
            'error' in result ? result.error : 'API key validation failed'
          setValidationStatus('invalid')
          setValidationMessage(message)
          toast.error('Validation failed', message)
          return
        }

        setValidationStatus('valid')
        setValidationMessage(
          data.summary?.recommendation || 'API key is valid and working!'
        )
        toast.success(
          'API key validated',
          'Your Tacticus API key is working correctly.'
        )
        setConfig((previous) => ({
          ...previous,
          api_key_is_valid: true,
          api_key_last_validated: result.validatedAt,
          API_Owner: result.validatedBy ?? previous.API_Owner
        }))
        setHasStoredApiKey(true)
      } else {
        const message =
          data.summary?.recommendation ||
          extractErrorMessage(data, 'API key validation failed')
        setValidationStatus('invalid')
        setValidationMessage(message)
        toast.error(
          'API key validation failed',
          data.summary?.recommendation ||
            extractErrorMessage(
              data,
              'Please check your API key and try again.'
            )
        )
      }
    } catch {
      setValidationStatus('invalid')
      setValidationMessage('Failed to validate API key. Please try again.')
      toast.error(
        'Validation error',
        'Failed to validate API key. Please try again.'
      )
    } finally {
      setValidatingApiKey(false)
    }
  }, [apiKey, config.guild_code, setConfig, toast])

  return {
    apiKey,
    setApiKey,
    showApiKey,
    toggleApiKeyVisibility: () => setShowApiKey((visible) => !visible),
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
  }
}
