'use client'

import { Spinner } from '@tacticus/ui-kit'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { dbClient } from '@/app/lib/db/client'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const [verifying, setVerifying] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const verifyEmail = async () => {
      const token = searchParams.get('token')
      const type = searchParams.get('type')

      if (!token || type !== 'email') {
        const enhancedError = createError(
          'EMAIL_VERIFICATION_FAILED',
          'Invalid verification link',
          { component: 'VerifyEmailContent', action: 'validate_token' }
        )
        const userError = formatErrorForUser(enhancedError)
        setError(userError.displayMessage)
        setVerifying(false)
        return
      }

      try {
        const supabase = dbClient()
        const { error } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: 'email'
        })

        if (error) throw error

        setSuccess(true)
      } catch (err) {
        const enhancedError = createError(
          'EMAIL_VERIFICATION_FAILED',
          err instanceof Error ? err.message : 'Verification failed',
          { component: 'VerifyEmailContent', action: 'verify_otp' },
          err
        )
        const userError = formatErrorForUser(enhancedError)
        setError(userError.displayMessage)
      } finally {
        setVerifying(false)
      }
    }

    verifyEmail()
  }, [searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-primary-wh40k">
            Email Verification
          </h2>
        </div>

        <div className="card-wh40k p-8">
          {verifying ? (
            <div className="text-center">
              <Spinner size="lg" className="mx-auto h-12 w-12" />
              <p className="mt-4 text-secondary-wh40k">
                Verifying your email...
              </p>
            </div>
          ) : success ? (
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-primary-wh40k">
                Email Verified!
              </h3>
              <p className="text-secondary-wh40k">
                Your email has been successfully verified. You can now log in to
                your account.
              </p>
              <Link href="/auth" className="btn-wh40k inline-block mt-4">
                Go to Login
              </Link>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-8 h-8 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-primary-wh40k">
                Verification Failed
              </h3>
              <p className="text-secondary-wh40k">
                {error ? (
                  <LinkifiedText text={error} />
                ) : (
                  'Something went wrong. Please try again.'
                )}
              </p>
              <Link href="/auth" className="btn-wh40k inline-block mt-4">
                Back to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Spinner size="lg" className="h-12 w-12" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  )
}
