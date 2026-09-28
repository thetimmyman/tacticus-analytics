'use client'

import React, { useId, useState } from 'react'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'
import { ScreenReaderOnly } from './ScreenReaderOnly'

interface ValidationResult {
  valid: boolean
  message?: string
}

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  showPasswordToggle?: boolean
  showCopyButton?: boolean
  validation?: (value: string) => ValidationResult
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    {
      label,
      error,
      hint,
      showPasswordToggle = false,
      showCopyButton = false,
      validation,
      className = '',
      type = 'text',
      id: idFromProps,
      'aria-describedby': describedByFromProps,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false)
    const [copied, setCopied] = useState(false)
    const [validationState, setValidationState] =
      useState<ValidationResult | null>(null)

    const reactId = useId()
    const inputId = idFromProps ?? `field-${reactId}`
    const errorId = `${inputId}-error`
    const hintId = `${inputId}-hint`
    const successId = `${inputId}-success`

    const validationFailed = validationState !== null && !validationState.valid
    const validationSucceeded =
      validationState !== null &&
      validationState.valid &&
      Boolean(validationState.message)
    const hasError =
      Boolean(error) || (validationFailed && Boolean(validationState?.message))
    const errorMessage =
      error ?? (validationFailed ? validationState?.message : undefined)

    const describedByIds: string[] = []
    if (describedByFromProps) describedByIds.push(describedByFromProps)
    if (hint && !hasError) describedByIds.push(hintId)
    if (validationSucceeded) describedByIds.push(successId)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (validation) {
        const result = validation(e.target.value)
        setValidationState(result)
      }
      if (props.onChange) {
        props.onChange(e)
      }
    }

    const handleCopy = () => {
      if (props.value) {
        navigator.clipboard.writeText(String(props.value))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }

    const inputType = showPasswordToggle && showPassword ? 'text' : type

    return (
      <div className="space-y-1">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-primary-wh40k"
          >
            {label}
          </label>
        )}

        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            aria-invalid={hasError || undefined}
            aria-errormessage={hasError ? errorId : undefined}
            aria-describedby={
              describedByIds.length > 0 ? describedByIds.join(' ') : undefined
            }
            className={`
            w-full px-4 py-3
            bg-(--input-bg) rounded-lg
            text-(--input-text) placeholder:text-secondary-wh40k
            focus:outline-hidden focus:ring-2 focus:ring-(--success) focus:border-(--success)
            disabled:bg-(--card-bg) disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-base
            ${hasError ? 'border-2 border-(--danger) bg-[color-mix(in_srgb,var(--danger)_15%,transparent)]' : 'border-2 border-(--input-border)'}
            ${className}
          `}
            onChange={handleChange}
            {...props}
          />

          {/* Password toggle button */}
          {showPasswordToggle && type === 'password' && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center text-secondary-wh40k hover:text-primary-wh40k transition-colors focus:outline-hidden focus:ring-2 focus:ring-(--accent) rounded-sm"
            >
              {showPassword ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
              <ScreenReaderOnly>
                {showPassword ? 'Hide password' : 'Show password'}
              </ScreenReaderOnly>
            </button>
          )}

          {/* Copy button */}
          {showCopyButton && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
              className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center text-secondary-wh40k hover:text-primary-wh40k transition-colors focus:outline-hidden focus:ring-2 focus:ring-(--accent) rounded-sm"
            >
              {copied ? (
                <Check
                  size={18}
                  className="text-(--success)"
                  aria-hidden="true"
                />
              ) : (
                <Copy size={18} aria-hidden="true" />
              )}
              <ScreenReaderOnly>
                {copied ? 'Copied to clipboard' : 'Copy to clipboard'}
              </ScreenReaderOnly>
            </button>
          )}
        </div>

        {/* Referenced via aria-errormessage; role=alert announces changes */}
        {hasError && (
          <div
            id={errorId}
            role="alert"
            aria-live="polite"
            className="mt-2 p-2 bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] border border-(--danger) rounded-sm"
          >
            <p className="text-sm text-(--danger) font-medium">
              {errorMessage}
            </p>
          </div>
        )}

        {/* Success message */}
        {validationSucceeded && (
          <p id={successId} className="text-sm text-(--success)">
            {validationState?.message}
          </p>
        )}

        {/* Hint message */}
        {hint && !hasError && (
          <p id={hintId} className="text-sm text-secondary-wh40k">
            {hint}
          </p>
        )}
      </div>
    )
  }
)

FormField.displayName = 'FormField'
