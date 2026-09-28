'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { dbClient } from '@/app/lib/db/client'
import {
  validatePassword,
  PASSWORD_MIN_LENGTH
} from '@/app/lib/validation/auth'
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
import { SITE_CONFIG } from '@/app/lib/config/constants'

interface ChangePasswordClientProps {
  userEmail: string
}

export default function ChangePasswordClient({
  userEmail
}: ChangePasswordClientProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // OAuth accounts and forgotten passwords cannot pass the current-password check; use email recovery.
  const handleSendResetLink = async () => {
    if (resetSending) return
    setError(null)
    setResetSending(true)
    try {
      const supabase = dbClient()
      const normalizedBaseUrl = SITE_CONFIG.CLEAN_URL.replace(/\/+$/, '')
      const resetRedirect = new URL('/auth/callback', normalizedBaseUrl)
      resetRedirect.searchParams.set('type', 'recovery')
      resetRedirect.searchParams.set('next', '/auth/reset-password')

      const { error: resetError } = await withTransientAuthRetry(
        () =>
          supabase.auth.resetPasswordForEmail(userEmail.toLowerCase(), {
            redirectTo: resetRedirect.toString()
          }),
        { isRetryableResult: isTransientSupabaseResult }
      )

      if (resetError) throw resetError
      setResetSent(true)
    } catch (err) {
      const enhancedError = isTransientAuthError(err)
        ? createError(
            'NETWORK_INTERRUPTED',
            TRANSIENT_AUTH_USER_MESSAGE,
            { component: 'ChangePasswordClient', action: 'send_reset_email' },
            err
          )
        : createError(
            'PASSWORD_RESET_FAILED',
            err instanceof Error ? err.message : 'Something went wrong',
            { component: 'ChangePasswordClient', action: 'send_reset_email' },
            err
          )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
    } finally {
      setResetSending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!currentPassword) {
      const enhancedError = createError(
        'FORM_VALIDATION_FAILED',
        'Current password is required',
        {
          component: 'ChangePasswordClient',
          action: 'validate_current_password'
        }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    const passwordValidation = validatePassword(newPassword)
    if (!passwordValidation.isValid) {
      const enhancedError = createError(
        'PASSWORD_VALIDATION_FAILED',
        passwordValidation.error || 'Invalid password',
        { component: 'ChangePasswordClient', action: 'validate_new_password' }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    if (newPassword !== confirmPassword) {
      const enhancedError = createError(
        'PASSWORD_MISMATCH',
        "Passwords don't match",
        { component: 'ChangePasswordClient', action: 'validate_password_match' }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    const verifyCurrentPassword = async () => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          email: userEmail,
          password: currentPassword,
          rememberMe: true
        })
      })

      const payload = (await response.json().catch(() => null)) as {
        success?: boolean
        error?: { message?: string }
      } | null

      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.error?.message || 'Current password is incorrect'
        )
      }
    }

    try {
      setSaving(true)

      // Each verify is a real login POST against the 5/min limit; cap retries.
      await withTransientAuthRetry(verifyCurrentPassword, { retries: 1 })
      const supabase = dbClient()

      const { error: updateError } = await withTransientAuthRetry(
        () => supabase.auth.updateUser({ password: newPassword }),
        { isRetryableResult: isTransientSupabaseResult }
      )

      if (updateError) throw updateError

      setSuccess(true)
      setTimeout(() => {
        router.push('/profile')
        router.refresh()
      }, 1500)
    } catch (err) {
      const enhancedError = isTransientAuthError(err)
        ? createError(
            'NETWORK_INTERRUPTED',
            TRANSIENT_AUTH_USER_MESSAGE,
            { component: 'ChangePasswordClient', action: 'change_password' },
            err
          )
        : createError(
            'PASSWORD_RESET_FAILED',
            err instanceof Error ? err.message : 'Failed to change password',
            { component: 'ChangePasswordClient', action: 'change_password' },
            err
          )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-primary-wh40k">
        Change Password
      </h1>

      <form
        method="post"
        onSubmit={handleSubmit}
        className="card-wh40k p-6 space-y-6"
      >
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <LinkifiedText
              text={error}
              className="text-sm text-red-400"
              linkClassName="text-red-300 hover:text-red-200 underline"
            />
          </div>
        )}

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3">
            <p className="text-sm text-emerald-400">
              Password changed successfully! Redirecting...
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium text-secondary-wh40k"
            >
              Current Password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input-wh40k w-full mt-1"
              required
              disabled={saving}
            />
            {resetSent ? (
              <p className="mt-2 text-xs text-emerald-400">
                Reset link sent to {userEmail} — open that email to set your new
                password. This works even if you only ever signed in with
                Discord or Google.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleSendResetLink}
                disabled={resetSending || saving}
                className="mt-2 text-xs text-secondary-wh40k hover:text-(--accent) underline disabled:opacity-50"
              >
                {resetSending
                  ? 'Sending reset link...'
                  : "Don't know your current password? (e.g. you signed up with Discord) Email me a reset link"}
              </button>
            )}
          </div>

          <div>
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium text-secondary-wh40k"
            >
              New Password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input-wh40k w-full mt-1"
              required
              disabled={saving}
              minLength={PASSWORD_MIN_LENGTH}
            />
            <p className="mt-1 text-xs text-secondary-wh40k">
              Must be at least {PASSWORD_MIN_LENGTH} characters, with a
              lowercase letter, an uppercase letter, and a number
            </p>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-secondary-wh40k"
            >
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-wh40k w-full mt-1"
              required
              disabled={saving}
            />
          </div>
        </div>

        <div className="pt-4 border-t border-(--card-border)">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 mb-4">
            <p className="text-sm text-yellow-400">
              <strong>Security Note:</strong> After changing your password,
              you&apos;ll need to sign in again on all devices.
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => router.push('/profile')}
              className="btn-wh40k"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-accent-wh40k"
              disabled={saving}
            >
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
