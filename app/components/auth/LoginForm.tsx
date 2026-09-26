'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { dbClient } from '@/app/lib/db/client'
import { authConfig } from '@/app/lib/auth/config'
import { RadixSwitch } from '@tacticus/ui-kit/radix-switch'
import {
  RadixTooltip,
  RadixTooltipTrigger,
  RadixTooltipContent
} from '@tacticus/ui-kit/radix-tooltip'
import { Button } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.auth.LoginForm')
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { FormField } from '@/app/components/ui/FormField'
import { ValidationError } from '@/app/components/ui/ValidationError'
import { useFeatureFlag } from '@/app/lib/utils/feature-flags'
import { brandColors } from '@/app/lib/utils/brand-buttons'
import { captureMessage, type SeverityLevel, withScope } from '@sentry/nextjs'
import { withTimeout, TimeoutError } from '@/app/lib/utils/async-timeout'
import { validateRedirectPath } from '@/app/lib/auth/redirect'

// Every awaited auth call races this deadline so a stalled response cannot stick the button.
const DEFAULT_LOGIN_TIMEOUT_MS = 20_000
const TIMEOUT_MESSAGE =
  'Sign-in timed out. Check your connection and try again.'

type OAuthProvider = 'discord' | 'google'

const GoogleIcon = () => (
  <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.92h5.45c-.24 1.26-.98 2.33-2.08 3.05l3.36 2.61c1.96-1.81 3.1-4.47 3.1-7.66 0-.74-.07-1.45-.2-2.14H12z"
    />
    <path
      fill="#34A853"
      d="M5.26 14.28 4.5 15.34l-2.73 2.1C3.5 20.9 7.46 23 12 23c2.7 0 4.96-.9 6.61-2.43l-3.36-2.61c-.93.63-2.12 1-3.25 1-2.5 0-4.63-1.69-5.4-3.99z"
    />
    <path
      fill="#4A90E2"
      d="M2.12 7.56C1.4 8.98 1 10.54 1 12c0 1.46.4 3.02 1.12 4.44 0 .01 4.14-3.22 4.14-3.22-.24-.72-.38-1.49-.38-2.22 0-.77.13-1.51.37-2.22z"
    />
    <path
      fill="#FBBC05"
      d="M12 5.5c1.48 0 2.8.51 3.85 1.51l2.88-2.88C16.94 2.35 14.7 1.5 12 1.5 7.46 1.5 3.5 3.6 1.77 7.34l4.1 3.18C6.73 7.19 9.5 5.5 12 5.5z"
    />
  </svg>
)

interface LoginFormProps {
  timeoutMs?: number
}

export default function LoginForm({
  timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS
}: LoginFormProps = {}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const lastReportedError = useRef<string | null>(null)

  const searchParams = useSearchParams()
  const supabase = dbClient()
  const isDiscordAuthEnabled = useFeatureFlag('discordAuth')
  const isGoogleAuthEnabled = useFeatureFlag('googleAuth')
  const isAnyOAuthEnabled = isDiscordAuthEnabled || isGoogleAuthEnabled

  const defaultRedirect = authConfig.redirects.afterLogin || '/'
  const rawRedirect = searchParams.get('redirectTo')
  // Same-origin paths only: rejects //host, /\host and encoded variants.
  const redirectTo = validateRedirectPath(rawRedirect) ?? defaultRedirect
  const reason = searchParams.get('reason')

  const reportAuthTelemetry = useCallback(
    (
      event: string,
      payload: Record<string, unknown>,
      level: SeverityLevel = 'warning'
    ) => {
      if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

      withScope((scope) => {
        scope.setLevel(level)
        scope.setTag('auth_event', event)
        scope.setTag('auth_flow', 'password')
        if (payload.errorCode) {
          scope.setTag('auth_error_code', String(payload.errorCode))
        }
        const safeContext = {
          ...(typeof payload.errorCode === 'string' &&
          /^[A-Z0-9_]{1,64}$/u.test(payload.errorCode)
            ? { errorCode: payload.errorCode }
            : {}),
          ...(typeof payload.supabaseStatus === 'number'
            ? { supabaseStatus: payload.supabaseStatus }
            : {}),
          ...(typeof payload.hasSession === 'boolean'
            ? { hasSession: payload.hasSession }
            : {}),
          ...(typeof payload.hasUser === 'boolean'
            ? { hasUser: payload.hasUser }
            : {})
        }
        if (Object.keys(safeContext).length > 0) {
          scope.setContext('auth', safeContext)
        }
        captureMessage(`auth_${event}`)
      })
    },
    []
  )

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (!errorParam) return
    if (lastReportedError.current === errorParam) return
    lastReportedError.current = errorParam

    reportAuthTelemetry(
      'login_redirect_error',
      {
        error: errorParam,
        reason: reason ?? null,
        redirectTo
      },
      'warning'
    )
  }, [searchParams, reason, redirectTo, reportAuthTelemetry])

  async function handleOAuthLogin(provider: OAuthProvider) {
    if (isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      const providerLabel = provider === 'discord' ? 'Discord' : 'Google'
      const scopes = provider === 'discord' ? 'identify email' : 'email profile'
      const { error } = await withTimeout(
        supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}&provider=${provider}`,
            scopes
          }
        }),
        timeoutMs,
        `${provider} oauth sign-in`
      )

      if (error) {
        logger.error({ provider, error }, '[LoginForm] OAuth error:')
        setError(
          `Could not sign in with ${providerLabel}. Please try again or use email/password.`
        )
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error(
          { provider, err: error, timeoutMs },
          '[LoginForm] OAuth sign-in timed out:'
        )
        setError(TIMEOUT_MESSAGE)
        return
      }
      logger.error({ provider, error }, '[LoginForm] OAuth login error:')
      setError(
        'Unable to complete social login. Please try again or use email/password.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      // Password auth runs server-side (ban check after GoTrue). One deadline bounds fetch and
      // body read: an edge 403 can send headers and never finish the body.
      const { response, payload } = await withTimeout(
        (async () => {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              email: email.trim().toLowerCase(),
              password,
              rememberMe
            })
          })
          const body = await res.json()
          return { response: res, payload: body }
        })(),
        timeoutMs,
        'sign in'
      )
      const authError = response.ok
        ? null
        : {
            message:
              payload?.error?.message ||
              payload?.message ||
              'Authentication failed',
            status: response.status,
            code: payload?.error?.metadata?.code || payload?.error?.code
          }
      const data = response.ok
        ? { user: payload.user, session: { serverPersisted: true } }
        : { user: null, session: null }

      if (authError || !data.user || !data.session) {
        const errorMessage = authError?.message || 'Invalid email or password'
        const isInvalidCreds = errorMessage
          .toLowerCase()
          .includes('invalid login credentials')
        const isBanned = /banned|suspended/i.test(errorMessage)
        const errorCode = isBanned
          ? 'ACCOUNT_BANNED'
          : isInvalidCreds
            ? 'LOGIN_INVALID_CREDENTIALS'
            : 'AUTH_FAILED'

        const enhancedError = createError(
          errorCode,
          isBanned
            ? 'This account has been suspended. Contact an app administrator if you believe this is a mistake.'
            : isInvalidCreds
              ? 'Invalid email or password'
              : errorMessage,
          { component: 'LoginForm' },
          authError
        )
        const userError = formatErrorForUser(enhancedError)
        // ValidationError renders nothing for a falsy message, so never pass an empty one.
        setError(userError.displayMessage || errorMessage)
        if (!isInvalidCreds) {
          reportAuthTelemetry('login_failed', {
            errorCode,
            supabaseStatus: authError?.status ?? null,
            hasSession: Boolean(data.session),
            hasUser: Boolean(data.user),
            redirectTo
          })
        }
        return
      }

      // Never set cookies manually: @supabase/ssr writes them and duplicates cause HTTP 431.

      window.location.href = redirectTo
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error(
          { err: error, timeoutMs },
          '[LoginForm] Sign-in timed out:'
        )
        reportAuthTelemetry(
          'login_timeout',
          {
            errorCode: 'NETWORK_INTERRUPTED',
            redirectTo
          },
          'warning'
        )
        setError(TIMEOUT_MESSAGE)
        return
      }
      logger.error({ err: error }, '[LoginForm] Unexpected error:')
      reportAuthTelemetry(
        'login_exception',
        {
          errorCode: 'AUTH_FAILED',
          redirectTo
        },
        'error'
      )
      const enhancedError = createError(
        'AUTH_FAILED',
        'An unexpected error occurred during login',
        { component: 'LoginForm' },
        error
      )
      const userError = formatErrorForUser(enhancedError)
      setError(
        userError.displayMessage ||
          'An unexpected error occurred during login. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] mb-2">
            Welcome Back
          </h2>
          <p className="text-sm sm:text-base text-[var(--text-secondary)]">
            Sign in to access the Command Deck
          </p>
        </div>

        {/* Show reason for redirect */}
        {reason === 'required' && (
          <div className="bg-blue-900/20 border border-blue-500/50 text-blue-200 px-4 py-3 rounded-lg text-sm">
            Please sign in to access this page.
          </div>
        )}

        {reason === 'expired' && (
          <div className="bg-yellow-900/20 border border-yellow-500/50 text-yellow-200 px-4 py-3 rounded-lg text-sm">
            Your session has expired. Please sign in again.
          </div>
        )}

        {reason === 'reset' && (
          <div className="bg-amber-900/20 border border-amber-500/50 text-amber-200 px-4 py-3 rounded-lg text-sm">
            We reset your session to resolve a login issue. Please sign in
            again.
          </div>
        )}

        {/* Error Display */}
        {error && <ValidationError message={error} />}

        <form method="post" onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            {/* Email Field */}
            <FormField
              id="email"
              name="email"
              type="email"
              label="Email Address"
              autoComplete="email"
              required
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
              placeholder="Enter your email"
            />

            {/* Password Field */}
            <FormField
              id="password"
              name="password"
              type="password"
              label="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPassword(e.target.value)
              }
              placeholder="Enter your password"
            />
          </div>

          {/* Remember me and forgot password */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center space-x-2">
              <RadixSwitch
                id="remember-me"
                checked={rememberMe}
                onCheckedChange={setRememberMe}
                className="data-[state=checked]:bg-[var(--primary)]"
              />
              <RadixTooltip>
                <RadixTooltipTrigger asChild>
                  <label
                    htmlFor="remember-me"
                    className="text-sm text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                  >
                    Remember me
                  </label>
                </RadixTooltipTrigger>
                <RadixTooltipContent>
                  <p className="text-xs">Keep me signed in on this device</p>
                </RadixTooltipContent>
              </RadixTooltip>
            </div>
            <div className="text-sm">
              <Link
                href="/auth/forgot-password"
                className="font-medium text-[var(--accent)] hover:brightness-110 underline"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {/* Submit Button */}
          <div className="grid w-full pt-4">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading}
              loading={isLoading}
              loadingText="Signing in..."
            >
              Sign In
            </Button>
          </div>

          {/* Social Login Options */}
          {isAnyOAuthEnabled && (
            <>
              <div className="pt-4">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--card-border)]" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                      Or continue with
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-3">
                {isDiscordAuthEnabled && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('discord')}
                    disabled={isLoading}
                    className="w-full flex justify-center items-center px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border"
                    style={{
                      backgroundColor: brandColors.discord.primary,
                      color: brandColors.discord.text,
                      borderColor: brandColors.discord.primary
                    }}
                  >
                    {isLoading ? (
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5 mr-3"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.615.874-1.266 1.226-1.963a.077.077 0 0 0-.041-.106 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.246.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.077.077 0 0 0-.041.107c.36.696.772 1.347 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
                      </svg>
                    )}
                    Continue with Discord
                  </button>
                )}

                {isGoogleAuthEnabled && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('google')}
                    disabled={isLoading}
                    className="w-full flex justify-center items-center px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border hover:brightness-110"
                    style={{
                      backgroundColor: brandColors.google.primary,
                      color: brandColors.google.text,
                      borderColor: brandColors.google.primary
                    }}
                  >
                    {isLoading ? (
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                    ) : (
                      <GoogleIcon />
                    )}
                    Continue with Google
                  </button>
                )}
              </div>
            </>
          )}

          {/* Signup Link */}
          <div className="text-center pt-6 border-t border-[var(--card-border)]">
            <p className="text-sm text-[var(--text-secondary)] pt-6">
              New to the cluster?{' '}
              <Link
                href="/auth/signup"
                className="text-[var(--accent)] hover:brightness-110 font-medium underline"
              >
                Create an account
              </Link>
            </p>

            {/* Privacy Policy and Terms Links */}
            <p className="text-xs text-[var(--text-secondary)] mt-4">
              By signing in, you agree to our{' '}
              <Link
                href="/terms"
                className="text-[var(--accent)] hover:brightness-110 underline"
              >
                Terms
              </Link>{' '}
              and{' '}
              <Link
                href="/privacy"
                className="text-[var(--accent)] hover:brightness-110 underline"
              >
                Privacy Policy
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
