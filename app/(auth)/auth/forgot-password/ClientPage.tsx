'use client'

import { useState } from 'react'
import Link from 'next/link'
import { dbClient } from '@/app/lib/db/client'
import { validateEmail } from '@/app/lib/validation/auth'
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
import { Button } from '@tacticus/ui-kit'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import { SITE_CONFIG } from '@/app/lib/config/constants'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const emailValidation = validateEmail(email)
    if (!emailValidation.isValid) {
      const enhancedError = createError(
        'EMAIL_VALIDATION_FAILED',
        emailValidation.error!,
        { component: 'ForgotPasswordPage', action: 'validate_email' }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    setLoading(true)
    try {
      const supabase = dbClient()
      const normalizedBaseUrl = SITE_CONFIG.CLEAN_URL.replace(/\/+$/, '')
      const resetRedirect = new URL('/auth/callback', normalizedBaseUrl)
      resetRedirect.searchParams.set('type', 'recovery')
      resetRedirect.searchParams.set('next', '/auth/reset-password')

      const { error } = await withTransientAuthRetry(
        () =>
          supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
            redirectTo: resetRedirect.toString()
          }),
        { isRetryableResult: isTransientSupabaseResult }
      )

      if (error) throw error

      setSuccess(true)
    } catch (err) {
      const enhancedError = isTransientAuthError(err)
        ? createError(
            'NETWORK_INTERRUPTED',
            TRANSIENT_AUTH_USER_MESSAGE,
            { component: 'ForgotPasswordPage', action: 'send_reset_email' },
            err
          )
        : createError(
            'PASSWORD_RESET_FAILED',
            err instanceof Error ? err.message : 'Something went wrong',
            { component: 'ForgotPasswordPage', action: 'send_reset_email' },
            err
          )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-primary-wh40k">
            Forgot Password?
          </h2>
          <p className="mt-2 text-secondary-wh40k">
            Enter your email and we&apos;ll send you a reset link
          </p>
        </div>

        <div className="card-wh40k p-8">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-8 h-8 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-primary-wh40k">
                Check Your Email
              </h3>
              <p className="text-secondary-wh40k">
                We&apos;ve sent a password reset link to {email}
              </p>
              <Link href="/auth" className="btn-wh40k inline-block mt-4">
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
                  <LinkifiedText
                    text={error}
                    className="text-sm text-red-400"
                    linkClassName="text-red-300 hover:text-red-200 underline"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-secondary-wh40k"
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-wh40k w-full mt-1"
                  placeholder="Enter your email"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="btn-accent-wh40k w-full"
                  loading={loading}
                  loadingText="🔒 Transmitting reset protocols..."
                  tooltip="Send a password reset link to your registered email"
                >
                  Send Reset Link
                </Button>
              </div>

              <div className="text-center">
                <Link
                  href="/auth"
                  className="text-sm text-secondary-wh40k hover:text-(--accent)"
                >
                  Back to login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
