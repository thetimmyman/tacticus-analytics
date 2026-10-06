'use client'

import { DesktopCredentialGuide } from '@/app/components/navigation/DesktopCredentialGuide'

import { useState, useEffect } from 'react'
import { Input } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import {
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Loader2,
  Info
} from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.validation.ValidatedApiKeyInput'
)

interface ValidatedApiKeyInputProps {
  label?: string
  value: string
  onChange: (value: string) => void
  onValidationChange?: (isValid: boolean, message?: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  autoValidate?: boolean
  showInstructions?: boolean
  className?: string
  validationScope?: 'guild' | 'player'
}

export function ValidatedApiKeyInput({
  label = 'API Key',
  value,
  onChange,
  onValidationChange,
  placeholder = 'Enter your API key',
  required = false,
  disabled = false,
  autoValidate = false,
  showInstructions = true,
  className = '',
  validationScope = 'guild'
}: ValidatedApiKeyInputProps) {
  const [showKey, setShowKey] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationStatus, setValidationStatus] = useState<
    'valid' | 'invalid' | 'checking' | null
  >(null)
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  )
  const [hasValidated, setHasValidated] = useState(false)

  useEffect(() => {
    if (
      process.env.NEXT_PUBLIC_RUNTIME_PROFILE !== 'desktop' &&
      autoValidate &&
      value &&
      !hasValidated
    ) {
      validateApiKey()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoValidate, value])

  const validateApiKey = async () => {
    if (process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop') return
    if (!value.trim()) {
      setValidationStatus('invalid')
      setValidationMessage('Please enter an API key')
      onValidationChange?.(false, 'Please enter an API key')
      return
    }

    setValidating(true)
    setValidationStatus('checking')
    setValidationMessage('Validating API key...')
    setHasValidated(true)

    try {
      const endpoint =
        validationScope === 'player'
          ? '/api/player/test-api-key'
          : '/api/guild/test-api-key'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: value.trim()
        })
      })

      const data = await response.json()
      const isValid = Boolean(data.success)
      const recommendation =
        data.summary?.recommendation ||
        data.summary?.message ||
        data.message ||
        data.error

      if (isValid) {
        setValidationStatus('valid')
        const message =
          recommendation ||
          (validationScope === 'player'
            ? 'Player API key validated successfully!'
            : 'API key is valid and working!')
        setValidationMessage(message)
        onValidationChange?.(true, message)
      } else {
        setValidationStatus('invalid')
        const message =
          recommendation ||
          (validationScope === 'player'
            ? 'Player API key validation failed'
            : 'API key validation failed')
        setValidationMessage(message)
        onValidationChange?.(false, message)
      }
    } catch (error) {
      logger.error({ err: error }, 'Error validating API key:')
      setValidationStatus('invalid')
      const message = 'Failed to validate API key. Please try again.'
      setValidationMessage(message)
      onValidationChange?.(false, message)
    } finally {
      setValidating(false)
    }
  }

  const handleChange = (newValue: string) => {
    onChange(newValue)
    if (validationStatus) {
      setValidationStatus(null)
      setValidationMessage(null)
      setHasValidated(false)
      onValidationChange?.(false)
    }
  }

  if (process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop')
    return <DesktopCredentialGuide />
  return (
    <div className={className}>
      {label && <Label htmlFor="api-key">{label}</Label>}

      <div className="flex gap-2 mt-1">
        <div className="relative flex-1">
          <Input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            className="pr-10 font-mono"
            placeholder={placeholder}
            disabled={disabled || validating}
            required={required}
            autoComplete="off"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary-wh40k hover:text-primary-wh40k"
            disabled={disabled || validating}
          >
            {showKey ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        <Button
          type="button"
          onClick={validateApiKey}
          disabled={disabled || validating || !value.trim()}
          variant="outline"
          className="min-w-[120px]"
        >
          {validating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Validating...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Validate
            </>
          )}
        </Button>
      </div>

      {/* Validation Status Message */}
      {validationStatus && (
        <div
          className={`mt-3 p-3 rounded-lg flex items-start gap-3 ${
            validationStatus === 'valid'
              ? 'bg-green-500/10 border border-green-500/30'
              : validationStatus === 'invalid'
                ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
                : 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)]'
          }`}
        >
          {validationStatus === 'valid' ? (
            <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
          ) : validationStatus === 'invalid' ? (
            <AlertCircle className="w-5 h-5 text-(--accent) mt-0.5 shrink-0" />
          ) : (
            <Loader2 className="w-5 h-5 text-(--primary) mt-0.5 animate-spin shrink-0" />
          )}
          <div className="flex-1">
            <p
              className={`text-sm font-semibold ${
                validationStatus === 'valid'
                  ? 'text-green-400'
                  : validationStatus === 'invalid'
                    ? 'text-(--accent)'
                    : 'text-(--primary)'
              }`}
            >
              {validationStatus === 'valid'
                ? 'API Key Valid!'
                : validationStatus === 'invalid'
                  ? 'Validation Failed'
                  : 'Checking...'}
            </p>
            {validationMessage && (
              <p
                className={`text-sm mt-1 ${
                  validationStatus === 'valid'
                    ? 'text-green-400/80'
                    : validationStatus === 'invalid'
                      ? 'text-[color-mix(in_srgb,var(--accent)_80%,transparent)]'
                      : 'text-[color-mix(in_srgb,var(--primary)_80%,transparent)]'
                }`}
              >
                {validationMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      {showInstructions && !validationStatus && (
        <div className="mt-3 p-3 bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-lg">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-(--primary) mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-(--primary) font-semibold">
                How to get your API key
              </p>
              <ol className="text-sm text-[color-mix(in_srgb,var(--primary)_80%,transparent)] mt-2 space-y-1 list-decimal list-inside">
                <li>
                  Go to{' '}
                  <a
                    href="https://api.tacticusgame.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-80"
                  >
                    api.tacticusgame.com
                  </a>
                </li>
                <li>
                  Click &ldquo;Create New API Key&rdquo; with read access to:
                  Player
                </li>
                <li>Copy and paste it above</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
