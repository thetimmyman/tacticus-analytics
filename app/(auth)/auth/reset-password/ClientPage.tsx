'use client'

import { useState, useEffect } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('auth.reset-password.page')
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import {
  isTransientAuthError,
  isTransientSupabaseResult,
  withTransientAuthRetry,
  TRANSIENT_AUTH_USER_MESSAGE
} from '@/app/lib/auth/retry-transient'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import { UI_CONFIG } from '@/app/lib/config/constants'
import {
  validatePassword,
  PASSWORD_MIN_LENGTH
} from '@/app/lib/validation/auth'

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const authCode = searchParams.get('code')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const checkSession = async () => {
      const supabase = dbClient()
      let exchangeError: Error | null = null

      const {
        data: { session: existingSession }
      } = await supabase.auth.getSession()
      let session = existingSession

      if (!session && authCode) {
        const { error } = await supabase.auth.exchangeCodeForSession(authCode)
        exchangeError = error ?? null

        if (exchangeError) {
          logger.warn(
            { exchangeError: exchangeError },
            'Password reset session exchange failed:'
          )
        }

        const {
          data: { session: exchangedSession }
        } = await supabase.auth.getSession()
        session = exchangedSession
      }

      if (!session) {
        const enhancedError = createError(
          'INVALID_RESET_LINK',
          'Invalid or expired reset link. Please request a new password reset.',
          { component: 'ResetPasswordPage', action: 'check_session' },
          exchangeError ?? undefined
        )
        const userError = formatErrorForUser(enhancedError)
        setError(userError.displayMessage)
      } else {
        setError(null)
      }
    }

    checkSession()
  }, [authCode])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      const enhancedError = createError(
        'PASSWORD_MISMATCH',
        'Passwords do not match',
        { component: 'ResetPasswordPage', action: 'validate_passwords' }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.isValid) {
      const enhancedError = createError(
        'PASSWORD_TOO_SHORT',
        passwordValidation.error ?? 'Password does not meet the policy',
        { component: 'ResetPasswordPage', action: 'validate_password_length' }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const supabase = dbClient()

      let {
        data: { session }
      } = await supabase.auth.getSession()
      if (!session && authCode) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(authCode)
        if (exchangeError) {
          logger.warn(
            { exchangeError: exchangeError },
            'Password reset session exchange failed during submit:'
          )
        }

        const {
          data: { session: exchangedSession }
        } = await supabase.auth.getSession()
        session = exchangedSession
      }

      if (!session) {
        const enhancedError = createError(
          'INVALID_RESET_LINK',
          'Invalid or expired reset link. Please request a new password reset.',
          { component: 'ResetPasswordPage', action: 'validate_session' }
        )
        const userError = formatErrorForUser(enhancedError)
        setError(userError.displayMessage)
        return
      }

      const { error: updateError } = await withTransientAuthRetry(
        () => supabase.auth.updateUser({ password: password }),
        { isRetryableResult: isTransientSupabaseResult }
      )

      if (updateError) {
        throw updateError
      }

      setSuccess(true)

      setTimeout(() => {
        router.push('/auth/login')
      }, UI_CONFIG.NOTIFICATION_TIMEOUT)
    } catch (err) {
      logger.error({ err: err }, 'Password reset error:')
      const enhancedError = isTransientAuthError(err)
        ? createError(
            'NETWORK_INTERRUPTED',
            TRANSIENT_AUTH_USER_MESSAGE,
            { component: 'ResetPasswordPage', action: 'reset_password' },
            err instanceof Error ? err : undefined
          )
        : createError(
            'PASSWORD_RESET_FAILED',
            err instanceof Error ? err.message : 'Failed to reset password',
            { component: 'ResetPasswordPage', action: 'reset_password' },
            err instanceof Error ? err : undefined
          )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
        <div className="max-w-md w-full">
          <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
              Password Reset Successful!
            </h2>
            <p className="text-[var(--text-secondary)] mb-4">
              Your password has been successfully reset.
            </p>
            <p className="text-[var(--text-secondary)] text-sm">
              Redirecting to login page...
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="max-w-md w-full">
        <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-8">
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-6 text-center">
            Reset Your Password
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg mb-6">
              <LinkifiedText
                text={error}
                linkClassName="text-red-300 hover:text-red-200 underline"
              />
            </div>
          )}

          <form method="post" onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
              >
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="Enter your new password"
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="Confirm your new password"
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !password || !confirmPassword}
              className="w-full py-3 px-4 bg-[var(--primary)] hover:bg-[var(--secondary)] disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
            >
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
            Remember your password?{' '}
            <a
              href="/auth/login"
              className="text-[var(--accent)] hover:text-blue-300"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
