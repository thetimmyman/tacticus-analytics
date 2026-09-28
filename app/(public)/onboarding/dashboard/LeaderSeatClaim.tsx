'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Input } from '@tacticus/ui-kit'
import { CheckCircle2, KeyRound } from 'lucide-react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { ValidationError } from '@/app/components/ui/ValidationError'

const logger = createComponentLogger('onboarding.leader-seat-claim')

/** For a new guild's registrar, who has no officer to issue an invite. */
export function LeaderSeatClaim({
  guildName,
  onClaimed
}: {
  guildName: string | null
  onClaimed?: () => void
}) {
  const router = useRouter()
  const supabase = dbClient()
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // The seat is bound either way.
  const [onboardingFinalized, setOnboardingFinalized] = useState(true)

  async function claim() {
    if (!apiKey.trim()) {
      setError('Enter your Player API key')
      return
    }
    setBusy(true)
    setError(null)

    try {
      const mintResponse = await fetch('/api/onboarding/leader/claim-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      })
      const minted = await mintResponse.json()
      if (!mintResponse.ok) {
        setError(
          extractErrorMessage(minted) ||
            'Could not verify that key against your roster.'
        )
        return
      }

      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) {
        setError('Your session expired. Sign in again.')
        return
      }

      // Invites are bearer credentials, but this code is bound to the account that proved possession.
      const { data, error: claimError } = await supabase.rpc(
        'claim_bootstrap_seat',
        { p_code: minted.code }
      )
      if (claimError) {
        logger.error({ err: claimError }, 'Leader seat bind failed')
        setError('Could not link your profile. Please try again.')
        return
      }
      const result = data as { success: boolean; error?: string }
      if (!result?.success) {
        setError(result?.error || 'Could not link your profile.')
        return
      }

      // Best-effort: the seat is bound, so failures must not read as a failed claim.
      let profileCompleted = true
      try {
        const completeResponse = await fetch(
          '/api/onboarding/complete-via-invite',
          { method: 'POST' }
        )
        if (!completeResponse.ok) {
          profileCompleted = false
          logger.warn(
            { status: completeResponse.status },
            'complete-via-invite rejected after seat claim'
          )
        }
      } catch (err) {
        profileCompleted = false
        logger.warn({ err }, 'complete-via-invite failed after seat claim')
      }
      setOnboardingFinalized(profileCompleted)
      try {
        await fetch('/api/player-api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() })
        })
      } catch (err) {
        logger.warn({ err }, 'API key save failed after seat claim')
      }

      onClaimed?.()
      setDone(true)
      setApiKey('')
      router.refresh()
    } catch (err) {
      logger.error({ err }, 'Leader seat claim threw')
      setError('An error occurred while claiming your profile.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        {onboardingFinalized ? (
          <p>Your profile is linked. Loading your dashboard…</p>
        ) : (
          <p>
            Your profile is linked. We could not finish marking onboarding
            complete —{' '}
            <Link href="/home" className="font-medium underline">
              go to your dashboard
            </Link>
            .
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] p-4">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-(--accent)" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary-wh40k">
            Link your player profile
          </p>
          <p className="text-xs text-secondary-wh40k">
            Paste an API key with <strong>Player</strong> read access.
            We&apos;ll match your player name against the roster already synced
            for {guildName || 'this guild'}. No invite code is needed for the
            first registrar.
          </p>
          <ol className="text-xs text-secondary-wh40k list-decimal list-inside space-y-0.5 my-1">
            <li>
              Go to{' '}
              <a
                href="https://api.tacticusgame.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--accent) underline hover:opacity-80"
              >
                api.tacticusgame.com
              </a>
            </li>
            <li>
              Click &quot;Create New API Key&quot; with Player read access
            </li>
            <li>Copy and paste it below</li>
          </ol>
        </div>
      </div>

      <Input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder="Paste your Player API key"
        aria-label="Player API key"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'leader-seat-error' : undefined}
        disabled={busy}
      />
      {error && <ValidationError id="leader-seat-error" message={error} />}

      <Button onClick={claim} disabled={busy} className="w-full">
        {busy ? 'Verifying…' : 'Link my profile'}
      </Button>
    </div>
  )
}
