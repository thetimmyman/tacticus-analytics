'use client'

/**
 * In-app signal for a sync stopped by a revoked key. Dismissal is per session and
 * incident id, since acknowledging does not resolve the incident.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { OpenRevokedKeyIncident } from '@/app/lib/data/revoked-key-incident'

const DISMISS_KEY_PREFIX = 'ta.revoked-key-banner.dismissed:'

function dismissKey(incidentId: string): string {
  return `${DISMISS_KEY_PREFIX}${incidentId}`
}

function readDismissed(incidentId: string): boolean {
  try {
    return globalThis.sessionStorage?.getItem(dismissKey(incidentId)) === 'true'
  } catch {
    // Storage failures must never suppress or crash this signal.
    return false
  }
}

function formatOpenedAt(openedAt: string | null): string | null {
  if (!openedAt) return null
  const parsed = new Date(openedAt)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

interface RevokedKeyBannerProps {
  incident: OpenRevokedKeyIncident | null
}

export function RevokedKeyBanner({ incident }: RevokedKeyBannerProps) {
  const incidentId = incident?.incidentId ?? null
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(incidentId ? readDismissed(incidentId) : false)
  }, [incidentId])

  if (!incident || dismissed) return null

  const guildLabel = incident.guildDisplayName ?? incident.guildCode
  const ownerLabel = incident.keyOwnerDisplayName
  const openedOn = formatOpenedAt(incident.openedAt)

  const onDismiss = () => {
    setDismissed(true)
    try {
      globalThis.sessionStorage?.setItem(
        dismissKey(incident.incidentId),
        'true'
      )
    } catch {
      // Losing dismissal only means the banner stays.
    }
  }

  return (
    <div
      role="alert"
      aria-label="Guild data sync stopped"
      className="mb-6 rounded-lg border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-4 py-3"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 text-sm text-[var(--text-primary)]">
          <h2 className="font-semibold">{guildLabel}: data sync has stopped</h2>
          <p className="mt-1 text-[var(--text-secondary)]">
            The Tacticus API key {ownerLabel ? `added by ${ownerLabel} ` : ''}
            is no longer valid
            {openedOn ? `, and nothing has synced since ${openedOn}` : ''}. Any
            guild member can fix this by adding a working key — nothing else is
            needed.
          </p>
          <p className="mt-2">
            <Link
              href="/api-keys"
              className="font-semibold text-[var(--accent)] underline"
            >
              Re-add the API key
            </Link>
          </p>
          {incident.viewerIsLeadership && !incident.hasDiscordContactChannel ? (
            <p className="mt-2 text-[var(--text-secondary)]">
              This guild has no Discord webhook, so we could not warn you
              anywhere but here.{' '}
              <Link
                href="/guild-management/settings?tab=integrations"
                className="underline"
              >
                Add a contact channel
              </Link>
              .
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Dismiss for this session"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
