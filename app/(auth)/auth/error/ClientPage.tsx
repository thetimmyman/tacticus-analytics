'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('auth.error.page')
const SAFE_AUTH_ERROR_CODES = new Set([
  'access_denied',
  'auth_failed',
  'configuration',
  'link_expired',
  'membership_lookup_failed',
  'middleware_error',
  'no_code',
  'onboarding_progress_missing',
  'session_exchange',
  'unexpected'
])
import { dbClient } from '@/app/lib/db/client'
import { authConfig } from '@/app/lib/auth/config'
import { MechanicusErrorLayout } from '@/app/components/error/MechanicusErrorLayout'
import { LoadingSpinner, Skeleton } from '@tacticus/ui-kit/loading'

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const error = searchParams.get('error')
  const description = searchParams.get('description')
  const provider = searchParams.get('provider')
  const [isChecking, setIsChecking] = useState(true)

  // The user may already be logged in (e.g. "token already used").
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = dbClient()
        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (session) {
          logger.info(
            '[Auth Error Page] User is authenticated, redirecting to home'
          )
          router.push(authConfig.redirects.afterLogin || '/')
          return
        }
      } catch (err) {
        logger.error(
          { err: err },
          '[Auth Error Page] Error checking auth status:'
        )
      } finally {
        setIsChecking(false)
      }
    }

    checkAuth()
  }, [router])

  if (typeof window !== 'undefined' && error) {
    if (error === 'access_denied') {
      logger.warn('[Auth Error Page] OAuth was cancelled by the user')
    } else {
      logger.error(
        {
          event: 'auth_error',
          errorCode: SAFE_AUTH_ERROR_CODES.has(error) ? error : 'unknown',
          hasDescription: Boolean(description)
        },
        '[Auth Error Page] Error'
      )
    }
  }

  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-black via-red-950 to-black">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-amber-400/60 mt-4 font-mono text-sm uppercase">
            Consulting Machine Spirit...
          </p>
        </div>
      </div>
    )
  }

  const getErrorDetails = () => {
    // Discord/Google identity already linked to another account.
    if (
      description?.toLowerCase().includes('identity') &&
      description?.toLowerCase().includes('already linked')
    ) {
      const providerName =
        provider === 'discord'
          ? 'Discord'
          : provider === 'google'
            ? 'Google'
            : 'This'
      return {
        protocol: 'PROTOCOL 409-IDENTITY-CONFLICT',
        errorCode: 'IDENTITY_ALREADY_LINKED',
        title: 'ACCOUNT ALREADY LINKED',
        message: `${providerName} account is already linked to a different Tacticus Analytics account. If this is your ${providerName} account, please contact support on the Tacticus Analytics Discord server for assistance.`,
        binaryCode: '01001100 01001001 01001110 01001011 01000101 01000100',
        binaryTranslation: 'LINKED'
      }
    }

    if (
      description?.includes('expired') ||
      description?.includes('already been used')
    ) {
      return {
        protocol: 'PROTOCOL 410-GAMMA-EXPIRED',
        errorCode: 'TOKEN_EXPIRED',
        title: 'AUTHENTICATION SEAL EXPIRED',
        message:
          'This sacred authentication seal has already been activated or has expired. The Machine Spirit requires a fresh authentication attempt.',
        binaryCode:
          '01000101 01011000 01010000 01001001 01010010 01000101 01000100',
        binaryTranslation: 'EXPIRED'
      }
    }

    switch (error) {
      case 'configuration':
        return {
          protocol: 'PROTOCOL 500-CONFIG-ERROR',
          errorCode: 'CONFIG_ERROR',
          title: 'CONFIGURATION MALFUNCTION',
          message:
            'The sacred configuration scrolls are corrupted. Tech-Adepts have been summoned for immediate repairs.',
          binaryCode: '01000011 01001111 01001110 01000110 01001001 01000111',
          binaryTranslation: 'CONFIG'
        }
      case 'no_code':
        return {
          protocol: 'PROTOCOL 400-BETA-INCOMPLETE',
          errorCode: 'NO_AUTH_CODE',
          title: 'AUTHENTICATION RUNE MISSING',
          message:
            'The authentication rune was not transmitted. Begin the authentication ritual anew.',
          binaryCode: '01001110 01001111 01000011 01001111 01000100 01000101',
          binaryTranslation: 'NO CODE'
        }
      case 'session_exchange':
        if (
          description?.includes('expired') ||
          description?.includes('already been used')
        ) {
          return {
            protocol: 'PROTOCOL 410-DELTA-USED',
            errorCode: 'TOKEN_USED',
            title: 'AUTHENTICATION SEAL CONSUMED',
            message:
              'This authentication seal has been consumed by the Machine Spirit. Request a new seal to proceed.',
            binaryCode: '01010101 01010011 01000101 01000100',
            binaryTranslation: 'USED'
          }
        }
        return {
          protocol: 'PROTOCOL 401-EPSILON-EXCHANGE',
          errorCode: 'SESSION_ERROR',
          title: 'AUTHENTICATION EXCHANGE FAILED',
          message:
            description ||
            'The sacred authentication exchange has failed. The Machine Spirit requires renewed authentication.',
          binaryCode:
            '01010011 01000101 01010011 01010011 01001001 01001111 01001110',
          binaryTranslation: 'SESSION'
        }
      case 'middleware_error':
        return {
          protocol: 'PROTOCOL 500-LAMBDA-PROCESS',
          errorCode: 'MIDDLEWARE_FAIL',
          title: 'COGITATOR PROCESSING ERROR',
          message:
            'The authentication cogitator experienced a processing error. Retry the authentication sequence.',
          binaryCode: '01001101 01001001 01000100 01000100 01001100 01000101',
          binaryTranslation: 'MIDDLE'
        }
      case 'access_denied':
        return {
          protocol: 'PROTOCOL 200-OMEGA-CANCEL',
          errorCode: 'USER_CANCELLED',
          title: 'SIGN-IN CANCELLED',
          message:
            'You cancelled the sign-in with your provider. No changes were made. If you want to continue, start the sign-in again.',
          binaryCode: '01000011 01000001 01001110 01000011 01000101 01001100',
          binaryTranslation: 'CANCEL'
        }
      case 'auth_failed':
        return {
          protocol: 'PROTOCOL 401-THETA-DENIED',
          errorCode: 'AUTH_FAILED',
          title: 'AUTHENTICATION REJECTED',
          message:
            'Your authentication credentials have been rejected by the Machine Spirit. Provide valid credentials to gain access.',
          binaryCode: '01000110 01000001 01001001 01001100 01000101 01000100',
          binaryTranslation: 'FAILED'
        }
      default:
        return {
          protocol: 'PROTOCOL 401-UNKNOWN-AUTH',
          errorCode: error || 'UNKNOWN_AUTH_ERROR',
          title: 'AUTHENTICATION ANOMALY',
          message:
            description ||
            'An anomaly occurred during authentication. The Machine Spirit requires you to begin the authentication ritual anew.',
          binaryCode:
            '01000001 01010101 01010100 01001000 01000101 01010010 01010010',
          binaryTranslation: 'AUTH ERR'
        }
    }
  }

  const errorDetails = getErrorDetails()

  return (
    <MechanicusErrorLayout
      {...errorDetails}
      technicalDetails={
        process.env.NODE_ENV === 'development'
          ? `Error: ${error}, Description: ${description}`
          : 'Additional details are available in the server logs.'
      }
      showHomeButton={true}
      showRetryButton={false}
      showLoginButton={true}
    >
      {/* Custom Authentication Error Content */}
      <div className="bg-amber-950/20 border border-amber-900/30 rounded-lg p-6 mb-6">
        <h3 className="text-amber-400 font-bold mb-3 text-center uppercase">
          Authentication Protocols:
        </h3>
        <ul className="text-gray-400 text-sm space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-amber-500 mt-1">▸</span>
            <span>
              Ensure your authentication credentials are properly sanctified
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500 mt-1">▸</span>
            <span>
              Verification links expire after 24 standard Terran hours
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500 mt-1">▸</span>
            <span>Each authentication seal may only be used once</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500 mt-1">▸</span>
            <span>Contact your Guild Magos if issues persist</span>
          </li>
        </ul>
      </div>
    </MechanicusErrorLayout>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-(--bg-from) via-red-950 to-(--bg-to)">
          <div className="space-y-2">
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
          </div>
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  )
}
