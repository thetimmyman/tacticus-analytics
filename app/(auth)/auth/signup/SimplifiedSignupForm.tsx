'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { dbClient } from '@/app/lib/db/client'
import { Button } from '@tacticus/ui-kit'
import { FormField } from '@/app/components/ui/FormField'
import { ValidationError } from '@/app/components/ui/ValidationError'
import { CheckCircle2 } from 'lucide-react'
import {
  validatePassword,
  PASSWORD_MIN_LENGTH
} from '@/app/lib/validation/auth'

type SignupField = 'displayName' | 'email' | 'password' | 'confirmPassword'

export default function SimplifiedSignupForm() {
  const router = useRouter()
  const supabase = dbClient()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<SignupField, string>>
  >({})
  const [requiresEmailConfirm, setRequiresEmailConfirm] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const signInButtonRef = useRef<HTMLButtonElement | null>(null)
  const showPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearFieldError = (field: SignupField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setFieldErrors({})
    setRequiresEmailConfirm(false)

    if (!displayName.trim()) {
      setFieldErrors({ displayName: 'Display name is required.' })
      return
    }

    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Passwords do not match.' })
      return
    }

    const passwordValidation = validatePassword(password)
    if (!passwordValidation.isValid) {
      setFieldErrors({ password: passwordValidation.error })
      return
    }

    setIsLoading(true)

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            role: 'onboarding'
          }
        }
      })

      if (signUpError) {
        throw signUpError
      }

      if (data?.session) {
        router.push('/onboarding')
        return
      }

      setRequiresEmailConfirm(true)
    } catch (signUpException) {
      const message =
        signUpException instanceof Error && signUpException.message
          ? signUpException.message
          : 'Unable to create your account. Please try again.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (requiresEmailConfirm) {
      if (showPromptTimerRef.current) {
        clearTimeout(showPromptTimerRef.current)
      }
      showPromptTimerRef.current = setTimeout(() => {
        setShowSignInPrompt(true)
      }, 6000)
    } else {
      setShowSignInPrompt(false)
      if (showPromptTimerRef.current) {
        clearTimeout(showPromptTimerRef.current)
      }
    }

    return () => {
      if (showPromptTimerRef.current) {
        clearTimeout(showPromptTimerRef.current)
      }
    }
  }, [requiresEmailConfirm])

  useEffect(() => {
    if (showSignInPrompt && signInButtonRef.current) {
      signInButtonRef.current.focus()
    }
  }, [showSignInPrompt])

  const handleGoToLogin = () => {
    router.push('/auth/login')
  }

  return (
    <form method="post" className="space-y-4" onSubmit={handleSubmit}>
      {error && <ValidationError message={error} />}

      {requiresEmailConfirm && (
        <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span>
              Check your inbox for a confirmation email. Once verified, sign in
              to finish onboarding.
            </span>
          </div>

          {showSignInPrompt && (
            <div className="flex flex-col gap-2 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-emerald-100 md:flex-row md:items-center md:justify-between">
              <p className="text-xs md:text-sm">
                Ready to continue? Jump to the sign-in form once you&apos;ve
                confirmed your email.
              </p>
              <Button
                ref={signInButtonRef}
                type="button"
                size="sm"
                variant="outline"
                className="border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/20"
                onClick={handleGoToLogin}
              >
                Go to Sign In
              </Button>
            </div>
          )}
        </div>
      )}

      <FormField
        id="displayName"
        label="Display Name"
        value={displayName}
        error={fieldErrors.displayName}
        onChange={(event) => {
          setDisplayName(event.target.value)
          clearFieldError('displayName')
        }}
        placeholder="How should we address you?"
        autoComplete="nickname"
        required
      />

      <FormField
        id="email"
        type="email"
        label="Email"
        value={email}
        error={fieldErrors.email}
        onChange={(event) => {
          setEmail(event.target.value)
          clearFieldError('email')
        }}
        placeholder="you@example.com"
        autoComplete="email"
        required
      />

      <FormField
        id="password"
        type="password"
        label="Password"
        value={password}
        error={fieldErrors.password}
        onChange={(event) => {
          setPassword(event.target.value)
          clearFieldError('password')
          clearFieldError('confirmPassword')
        }}
        placeholder={`Minimum ${PASSWORD_MIN_LENGTH} characters`}
        autoComplete="new-password"
        required
      />

      <FormField
        id="confirmPassword"
        type="password"
        label="Confirm Password"
        value={confirmPassword}
        error={fieldErrors.confirmPassword}
        onChange={(event) => {
          setConfirmPassword(event.target.value)
          clearFieldError('confirmPassword')
        }}
        placeholder="Re-enter your password"
        autoComplete="new-password"
        required
      />

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={isLoading}
        loadingText="Creating account..."
      >
        Create Account
      </Button>

      <p className="text-center text-sm text-[var(--text-secondary)]">
        Already have an account?{' '}
        <a href="/auth/login" className="text-[var(--accent)] hover:underline">
          Sign in
        </a>
      </p>
    </form>
  )
}
