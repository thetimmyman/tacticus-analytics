'use client'

import { useEffect, useState, type JSX } from 'react'
import type { User } from '@supabase/supabase-js'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.auth.OAuthAccountLink')
import { brandColors } from '@/app/lib/utils/brand-buttons'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'

type OAuthProvider = 'discord' | 'google'

interface OAuthAccountLinkProps {
  provider: OAuthProvider
  isLinked: boolean
  displayName?: string | null
  onLinkChange?: (linked: boolean, displayName?: string | null) => void
  profileRedirect?: string
}

const DiscordIcon = () => (
  <svg
    className="w-8 h-8"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.615.874-1.266 1.226-1.963a.077.077 0 0 0-.041-.106 13.201 13.201 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.246.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.077.077 0 0 0-.041.107c.36.696.772 1.347 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z" />
  </svg>
)

const GoogleIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" aria-hidden="true">
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

const providerCopy: Record<
  OAuthProvider,
  { label: string; description: string; icon: JSX.Element }
> = {
  discord: {
    label: 'Discord',
    description: 'Use Discord for faster login and synced profile details.',
    icon: <DiscordIcon />
  },
  google: {
    label: 'Google',
    description: 'Connect Google for one-tap login with your Google account.',
    icon: <GoogleIcon />
  }
}

/** Handles GoTrue and legacy raw-Discord shapes; prefers global name, then username. */
function formatDiscordUsername(user: User): string | null {
  const claims = extractDiscordIdentityClaims(user)
  if (!claims) return null
  return claims.discordGlobalName || claims.discordUsername
}

function formatGoogleIdentity(
  identityData?: Record<string, unknown> | null,
  fallbackEmail?: string | null
): string | null {
  if (!identityData) return fallbackEmail || null
  return (
    (identityData.email as string) ||
    (identityData.full_name as string) ||
    (identityData.name as string) ||
    fallbackEmail ||
    null
  )
}

export default function OAuthAccountLink({
  provider,
  isLinked,
  displayName,
  onLinkChange,
  profileRedirect = '/profile'
}: OAuthAccountLinkProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linked, setLinked] = useState(isLinked)
  const [connectedName, setConnectedName] = useState<string | null>(
    displayName || null
  )
  const [showConfirmation, setShowConfirmation] = useState(false)
  const supabase = dbClient()

  useEffect(() => {
    setLinked(isLinked)
    setConnectedName(displayName || null)
  }, [displayName, isLinked])

  useEffect(() => {
    let active = true
    const syncFromSupabaseUser = async () => {
      try {
        const {
          data: { user }
        } = await supabase.auth.getUser()
        if (!active || !user) return
        const identity = user.identities?.find((i) => i.provider === provider)
        if (identity) {
          const name =
            provider === 'discord'
              ? formatDiscordUsername(user)
              : formatGoogleIdentity(identity.identity_data, user.email ?? null)
          setLinked(true)
          if (name) setConnectedName(name)
          onLinkChange?.(true, name ?? undefined)
        } else {
          setLinked(false)
          setConnectedName(null)
          onLinkChange?.(false)
        }
      } catch (refreshError) {
        logger.debug(
          { provider, refreshError },
          '[OAuth Link] Identity refresh skipped'
        )
      }
    }
    syncFromSupabaseUser()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  const colors = brandColors[provider]
  const meta = providerCopy[provider]

  const refreshIdentityName = async (): Promise<string | null> => {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    const identity = user?.identities?.find((i) => i.provider === provider)
    if (!identity || !user) return null
    if (provider === 'discord') {
      return formatDiscordUsername(user)
    }
    return formatGoogleIdentity(identity.identity_data, user.email ?? null)
  }

  const handleLinkClick = () => {
    setError(null)
    setShowConfirmation(true)
  }

  const handleConfirmLink = async () => {
    setShowConfirmation(false)
    if (loading) return
    setLoading(true)
    setError(null)

    try {
      const scopes = provider === 'discord' ? 'identify email' : 'email profile'
      // Each link/relink gets a fresh fail-closed generation; the single-use nonce stays
      // in an encrypted HttpOnly cookie, never in component state.
      if (provider === 'discord') {
        const prepareResponse = await fetch('/api/auth/sync-discord', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!prepareResponse.ok) {
          setError('Could not safely prepare Discord linking. Please retry.')
          return
        }
      }
      const { error: linkError } = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(profileRedirect)}&provider=${provider}`,
          scopes
        }
      })

      if (linkError) {
        logger.error(
          { provider, error: linkError },
          '[OAuth Link] Failed to link provider:'
        )
        setError(`Could not link ${meta.label}. Please try again.`)
        return
      }

      // If linkIdentity resolves in place, sync player_mapping here (mirrors the unlink DELETE).
      if (provider === 'discord') {
        try {
          await fetch('/api/auth/sync-discord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
        } catch (syncError) {
          logger.warn(
            { syncError },
            '[OAuth Link] Failed to sync Discord profile data:'
          )
        }
      }

      const name = await refreshIdentityName()
      setLinked(true)
      if (name) setConnectedName(name)
      onLinkChange?.(true, name ?? undefined)
    } catch (linkError) {
      logger.error(
        { provider, error: linkError },
        '[OAuth Link] Unexpected error:'
      )
      setError('Unable to link right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleUnlink = async () => {
    if (loading) return
    setLoading(true)
    setError(null)

    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      const identity = user?.identities?.find((i) => i.provider === provider)

      if (!identity) {
        setError(`${meta.label} account not found`)
        setLoading(false)
        return
      }

      // Two-phase unlink: clear database authority first, so a failed provider unlink
      // leaves the account denied and retryable, not stale-linked.
      if (provider === 'discord') {
        const prepareResponse = await fetch('/api/auth/sync-discord', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!prepareResponse.ok) {
          setError(
            'Could not safely prepare Discord unlink. No provider change was made.'
          )
          return
        }
      }

      const { error: unlinkError } =
        await supabase.auth.unlinkIdentity(identity)
      if (unlinkError) {
        logger.error(
          { provider, error: unlinkError },
          '[OAuth Link] Failed to unlink provider:'
        )
        setError(
          provider === 'discord'
            ? 'Discord access was disabled in the app, but the provider unlink failed. Retry unlinking; the old link will not be restored.'
            : `Could not unlink ${meta.label}. Please try again.`
        )
        return
      }

      if (provider === 'discord') {
        const confirmResponse = await fetch('/api/auth/sync-discord', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!confirmResponse.ok) {
          logger.warn(
            { status: confirmResponse.status },
            '[OAuth Link] Provider unlinked but canonical confirmation failed'
          )
          setError(
            'Discord was unlinked, but verification did not complete. Refresh before linking another account.'
          )
          return
        }
      }

      setLinked(false)
      setConnectedName(null)
      onLinkChange?.(false)
    } catch (unlinkError) {
      logger.error(
        { provider, error: unlinkError },
        '[OAuth Link] Unexpected unlink error:'
      )
      setError('Unable to unlink right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0 text-[var(--text-primary)]">
            {meta.icon}
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              {meta.label} Account
            </h3>
            {linked ? (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-secondary)]">
                  Connected
                  {connectedName ? (
                    <>
                      {' '}
                      as <span className="font-medium">{connectedName}</span>
                    </>
                  ) : (
                    ''
                  )}
                </p>
                <div className="flex items-center space-x-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: colors.primary }}
                  ></div>
                  <span className="text-xs" style={{ color: colors.primary }}>
                    Linked
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-secondary)]">
                  {meta.description}
                </p>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                  <span className="text-xs text-[var(--text-secondary)]">
                    Not linked
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0">
          {linked ? (
            <button
              type="button"
              onClick={handleUnlink}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed border"
              style={{
                color: colors.primary,
                borderColor: colors.primary,
                backgroundColor: 'transparent'
              }}
            >
              {loading ? 'Unlinking...' : 'Unlink'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLinkClick}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed border"
              style={{
                backgroundColor: colors.primary,
                color: colors.text,
                borderColor: colors.primary
              }}
            >
              {loading ? 'Linking...' : `Link ${meta.label}`}
            </button>
          )}
        </div>
      </div>

      {showConfirmation && (
        <div className="p-4 bg-amber-900/20 border border-amber-500/50 rounded-lg">
          <p className="text-amber-200 text-sm font-medium mb-2">
            Confirm {meta.label} Account
          </p>
          <p className="text-[var(--text-primary)] text-xs mb-3">
            You&apos;ll be redirected to {meta.label} to authorize. Make sure
            you&apos;re logged into the correct {meta.label} account before
            continuing.
          </p>
          <p className="text-amber-400/80 text-xs mb-4">
            If you have multiple {meta.label} accounts, verify you&apos;re
            signed into the right one in your browser.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirmLink}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
              style={{
                backgroundColor: colors.primary,
                color: colors.text
              }}
            >
              {loading ? 'Linking...' : `Continue to ${meta.label}`}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirmation(false)}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 bg-gray-700 text-[var(--text-primary)] hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-500/50 text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {linked && (
        <div className="p-3 bg-blue-900/20 border border-blue-500/50 text-blue-200 rounded-lg text-sm">
          <p className="font-medium mb-1">Connected with {meta.label}</p>
          <ul className="text-xs space-y-1 list-disc list-inside">
            <li>Use {meta.label} login for faster authentication</li>
            <li>Keep your profile details in sync</li>
            <li>Reduce password reset friction on future sign-ins</li>
          </ul>
        </div>
      )}
    </div>
  )
}
