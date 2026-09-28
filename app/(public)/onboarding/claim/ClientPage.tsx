'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Input } from '@tacticus/ui-kit'
import { dbClient } from '@/app/lib/db/client'
import {
  CheckCircle2,
  KeyRound,
  UserIcon,
  Shield,
  AlertCircle
} from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('onboarding.claim.page')
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { normalizeInviteCode } from '@/app/lib/onboarding/invite-code-normalization'
import { ValidationError } from '@/app/components/ui/ValidationError'
import type { ClaimErrorCode } from '@/app/api/onboarding/claim/consume/error-codes'

/** The consume route also needs /guild (Step 2 only proves /player), so these re-show the key input. */
const KEY_FIXABLE_CLAIM_CODES = [
  'API_KEY_REQUIRED',
  'GUILD_SCOPE_REQUIRED',
  'PLAYER_SCOPE_REQUIRED',
  'GUILD_NOT_REGISTERED',
  'KEY_NOT_IN_TARGET_GUILD',
  'POSSESSION_NAME_MISMATCH',
  'TARGET_NOT_IN_KEY_GUILD'
] as const satisfies readonly ClaimErrorCode[]

function isKeyFixableRejection(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (KEY_FIXABLE_CLAIM_CODES as readonly string[]).includes(code)
  )
}

function ClaimPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = dbClient()

  const [inviteCode, setInviteCode] = useState(
    normalizeInviteCode(searchParams.get('code') || '')
  )
  const [codeInfo, setCodeInfo] = useState<{
    valid: boolean
    player_id?: string
    display_name?: string
    guild_code?: string
    guild_name?: string
    expires_at?: string
    error?: string
  } | null>(null)
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiKeyValidated, setApiKeyValidated] = useState(false)
  const [apiKeyLoading, setApiKeyLoading] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [playerName, setPlayerName] = useState<string | null>(null)

  const [claimLoading, setClaimLoading] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimSuccess, setClaimSuccess] = useState(false)

  const [currentUser, setCurrentUser] = useState<{
    id: string
    email?: string
  } | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      setCurrentUser(user)
      setAuthChecking(false)
    }
    checkAuth()
  }, [supabase])

  useEffect(() => {
    if (searchParams.get('code') && !codeInfo) {
      validateCode(searchParams.get('code')!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time validation on mount when URL has code param
  }, [searchParams])

  const validateCode = async (code: string) => {
    const normalized = normalizeInviteCode(code || '')
    if (normalized.length < 6) {
      setCodeError('Please enter a valid invite code')
      return
    }

    setCodeLoading(true)
    setCodeError(null)
    setCodeInfo(null)

    try {
      const { data, error } = await supabase.rpc('get_invite_code_info', {
        p_code: normalized
      })

      if (error) {
        logger.error({ err: error }, 'Code validation error')
        setCodeError('Failed to validate code')
        return
      }

      const info = data as typeof codeInfo
      if (!info?.valid) {
        setCodeError(info?.error || 'Invalid invite code')
        return
      }

      setCodeInfo(info)
      // The claim consumes this exact validated string.
      setInviteCode(normalized)
    } catch (err) {
      logger.error({ err: err }, 'Code validation exception')
      setCodeError('Failed to validate code')
    } finally {
      setCodeLoading(false)
    }
  }

  const validateApiKey = async () => {
    if (!apiKeyInput.trim()) {
      setApiKeyError('Please enter your API key')
      return
    }

    setApiKeyLoading(true)
    setApiKeyError(null)

    try {
      const response = await fetch('/api/onboarding/validate-player-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() })
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setApiKeyError(extractErrorMessage(data, 'Invalid API key'))
        return
      }

      if (codeInfo?.display_name && data.playerName !== codeInfo.display_name) {
        setApiKeyError(
          `API key mismatch: This API key belongs to "${data.playerName}" but the invite code is for "${codeInfo.display_name}". Please use the correct API key.`
        )
        return
      }

      setPlayerName(data.playerName)
      setApiKeyValidated(true)
    } catch (err) {
      logger.error({ err: err }, 'API key validation error')
      setApiKeyError('Failed to validate API key')
    } finally {
      setApiKeyLoading(false)
    }
  }

  const handleClaim = async () => {
    if (!currentUser) {
      const returnPath = `/onboarding/claim?code=${inviteCode}`
      router.push(`/auth/login?redirectTo=${encodeURIComponent(returnPath)}`)
      return
    }

    if (!codeInfo?.valid || !apiKeyValidated) {
      setClaimError('Please complete all verification steps')
      return
    }

    setClaimLoading(true)
    setClaimError(null)

    try {
      // The route re-proves key possession server-side; the compare above is only a pre-check.
      const response = await fetch('/api/onboarding/claim/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: inviteCode,
          apiKey: apiKeyInput.trim()
        })
      })

      const data = await response.json()

      if (!response.ok || !data?.success) {
        logger.warn({ status: response.status }, 'Claim rejected')
        const message = extractErrorMessage(data, 'Failed to claim profile')
        const code = (data as { error?: { code?: unknown } })?.error?.code
        if (isKeyFixableRejection(code)) {
          // The user is usually just changing the key's scope.
          setApiKeyValidated(false)
          setApiKeyError(message)
          setClaimError(null)
          return
        }
        setClaimError(message)
        return
      }

      try {
        const completeResponse = await fetch(
          '/api/onboarding/complete-via-invite',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }
        )
        if (!completeResponse.ok) {
          logger.warn(
            {
              status: completeResponse.status
            },
            'Failed to complete onboarding via invite'
          )
        }
      } catch (completeErr) {
        logger.warn(
          { completeErr: completeErr },
          'Exception completing onboarding via invite'
        )
      }

      const apiKeyResponse = await fetch('/api/player-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() })
      })

      if (!apiKeyResponse.ok) {
        logger.warn(
          { status: apiKeyResponse.status },
          'Failed to save API key after claim'
        )
      }

      setClaimSuccess(true)
      setTimeout(() => {
        router.push('/?welcome=true')
      }, 2000)
    } catch (err) {
      logger.error({ err: err }, 'Claim exception')
      setClaimError('An error occurred while claiming your profile')
    } finally {
      setClaimLoading(false)
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-secondary-wh40k">Loading...</div>
      </div>
    )
  }

  if (claimSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card-wh40k p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-emerald-400 mx-auto" />
          <h1 className="text-2xl font-bold text-primary-wh40k">
            Profile Claimed!
          </h1>
          <p className="text-secondary-wh40k">
            Welcome{codeInfo?.guild_name ? ` to ${codeInfo.guild_name}` : ''},{' '}
            {playerName || codeInfo?.display_name}!
          </p>
          <p className="text-sm text-(--text-tertiary)">
            Redirecting you to the dashboard...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-lg mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-primary-wh40k">
            Claim Your Profile
          </h1>
          <p className="text-secondary-wh40k">
            Use the invite code from your guild officer to claim your player
            profile
          </p>
        </div>

        {!currentUser && (
          <div className="card-wh40k p-4 border-amber-500/40 bg-amber-500/10">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-200 font-medium">
                  Sign in required
                </p>
                <p className="text-xs text-amber-200/70 mt-1">
                  You&apos;ll need to sign in or create an account to claim your
                  profile.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="card-wh40k p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${codeInfo?.valid ? 'bg-emerald-500 text-white' : 'bg-blue-500/20 text-blue-300'}`}
              >
                {codeInfo?.valid ? <CheckCircle2 className="h-4 w-4" /> : '1'}
              </div>
              <Shield className="h-4 w-4" />
              Invite Code
            </div>

            {!codeInfo?.valid ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    id="invite-code"
                    aria-label="Invite code"
                    value={inviteCode}
                    onChange={(e) => {
                      setInviteCode(normalizeInviteCode(e.target.value))
                      setCodeError(null)
                    }}
                    aria-invalid={Boolean(codeError) || undefined}
                    aria-errormessage={
                      codeError ? 'invite-code-error' : undefined
                    }
                    placeholder="Enter your invite code (e.g., A1B2C3D4E5F6)"
                    className="min-h-[44px] flex-1 font-mono uppercase tracking-wider"
                    // maxLength applies before whitespace is stripped.
                    maxLength={32}
                  />
                  <Button
                    onClick={() => validateCode(inviteCode)}
                    loading={codeLoading}
                    loadingText="Checking..."
                    className="min-h-[44px] w-full sm:w-auto"
                  >
                    Verify
                  </Button>
                </div>
                {codeError && (
                  <ValidationError id="invite-code-error" message={codeError} />
                )}
                {/* Leaders of an unregistered guild land here too. */}
                <p className="text-xs text-secondary-wh40k">
                  Don&apos;t have a code? Ask your guild leader or officer to
                  generate one for you.
                </p>
                <p className="text-xs text-secondary-wh40k">
                  Lead the guild yourself, or nobody there has set it up?{' '}
                  <Link
                    href="/onboarding/dashboard"
                    className="text-(--accent) hover:underline"
                  >
                    Claim your seat with your API key
                  </Link>{' '}
                  — no invite code needed.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <div>
                    <p className="font-semibold text-emerald-200">
                      Code Verified
                    </p>
                    <p className="text-sm text-emerald-100/80">
                      Player:{' '}
                      <span className="font-medium">
                        {codeInfo.display_name}
                      </span>
                    </p>
                    <p className="text-sm text-emerald-100/60">
                      Guild:{' '}
                      <span className="font-medium">
                        {formatGuildDisplayLabel(
                          {
                            display_name: codeInfo.guild_name,
                            guild_code: codeInfo.guild_code
                          },
                          codeInfo.guild_code
                        )}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {codeInfo?.valid && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${apiKeyValidated ? 'bg-emerald-500 text-white' : 'bg-blue-500/20 text-blue-300'}`}
                >
                  {apiKeyValidated ? <CheckCircle2 className="h-4 w-4" /> : '2'}
                </div>
                <KeyRound className="h-4 w-4" />
                Player API Key
              </div>

              {!apiKeyValidated ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      id="player-api-key"
                      aria-label="Player API key"
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value)
                        setApiKeyError(null)
                      }}
                      aria-invalid={Boolean(apiKeyError) || undefined}
                      aria-errormessage={
                        apiKeyError ? 'player-api-key-error' : undefined
                      }
                      placeholder="Paste your Player API key"
                      className="min-h-[44px] flex-1"
                    />
                    <Button
                      onClick={validateApiKey}
                      loading={apiKeyLoading}
                      loadingText="Validating..."
                      className="min-h-[44px] w-full sm:w-auto"
                    >
                      Validate
                    </Button>
                  </div>
                  {apiKeyError && (
                    <ValidationError
                      id="player-api-key-error"
                      message={apiKeyError}
                    />
                  )}
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-secondary-wh40k">
                    <p className="font-medium text-blue-200 mb-2">
                      How to get your API key:
                    </p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>
                        Go to{' '}
                        <a
                          href="https://api.tacticusgame.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 underline hover:text-blue-200"
                        >
                          api.tacticusgame.com
                        </a>
                      </li>
                      {/* Player scope suffices (claims are checked against the synced roster). */}
                      <li>
                        Click &quot;Create New API Key&quot; with read access
                        to: <strong>Player</strong> (add <strong>Guild</strong>{' '}
                        too if you are a leader or co-leader — it&apos;s not
                        required)
                      </li>
                      <li>Copy and paste it above</li>
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <div className="flex-1">
                      <p className="font-semibold text-emerald-200">
                        API Key Validated
                      </p>
                      <p className="text-sm text-emerald-100/80">
                        Player:{' '}
                        <span className="font-medium">{playerName}</span>
                      </p>
                    </div>
                    {/* The claim can still refuse a "validated" key. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setApiKeyValidated(false)
                        setApiKeyError(null)
                        setClaimError(null)
                      }}
                    >
                      Use a different key
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {codeInfo?.valid && apiKeyValidated && (
            <div className="space-y-4 pt-4 border-t border-(--card-border)">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
                <div className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold bg-blue-500/20 text-blue-300">
                  3
                </div>
                <UserIcon className="h-4 w-4" />
                Claim Profile
              </div>

              {claimError && <ValidationError message={claimError} />}

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
                <p className="text-sm text-secondary-wh40k mb-4">
                  You&apos;re about to claim the profile for{' '}
                  <span className="font-medium text-primary-wh40k">
                    {codeInfo.display_name}
                  </span>{' '}
                  in guild{' '}
                  <span className="font-medium text-primary-wh40k">
                    {formatGuildDisplayLabel(
                      {
                        display_name: codeInfo.guild_name,
                        guild_code: codeInfo.guild_code
                      },
                      codeInfo.guild_code
                    )}
                  </span>
                  .
                </p>

                {currentUser ? (
                  <Button
                    onClick={handleClaim}
                    loading={claimLoading}
                    loadingText="Claiming..."
                    className="w-full"
                  >
                    Claim My Profile
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      const returnPath = `/onboarding/claim?code=${inviteCode}`
                      router.push(
                        `/auth/login?redirectTo=${encodeURIComponent(returnPath)}`
                      )
                    }}
                    className="w-full"
                  >
                    Sign In to Claim Profile
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="text-center">
          <Link
            href="/onboarding"
            className="text-sm text-secondary-wh40k hover:text-(--accent)"
          >
            ← Back to onboarding options
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function ClaimPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-secondary-wh40k">Loading...</div>
        </div>
      }
    >
      <ClaimPageContent />
    </Suspense>
  )
}
