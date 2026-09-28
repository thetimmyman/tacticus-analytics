'use client'

/**
 * In-app signal for a guild whose data sync has stopped. Dismissal is per
 * session and incident id, since acknowledging does not resolve the incident.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { OpenGuildSyncIncident } from '@/app/lib/data/guild-sync-incident'

const DISMISS_KEY_PREFIX = 'ta.guild-sync-banner.dismissed:'

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

// No incident means the guild recovered; a later incident with the same id must show again.
function clearDismissals(): void {
  try {
    const storage = globalThis.sessionStorage
    if (!storage) return
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i)
      if (key?.startsWith(DISMISS_KEY_PREFIX)) storage.removeItem(key)
    }
  } catch {
    // Storage failures only mean an old dismissal may linger.
  }
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  // UTC with minutes, so "since" stays true for a sync later the same day and server/client render alike.
  const iso = parsed.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

interface GuildSyncStoppedBannerProps {
  incident: OpenGuildSyncIncident | null
}

export function GuildSyncStoppedBanner({
  incident
}: GuildSyncStoppedBannerProps) {
  const incidentId = incident?.incidentId ?? null
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!incidentId) clearDismissals()
    setDismissed(incidentId ? readDismissed(incidentId) : false)
  }, [incidentId])

  if (!incident || dismissed) return null

  const guildLabel = incident.guildDisplayName ?? incident.guildCode
  const ownerLabel = incident.keyOwnerDisplayName
  const date = formatDate(incident.lastSuccessfulSyncAt)
  const sinceText = date ? ` since ${date}` : ''

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

  const heading =
    incident.reason === 'stale'
      ? `${guildLabel}: guild data is out of date`
      : `${guildLabel}: data sync has stopped`

  let body: string
  switch (incident.reason) {
    case 'invalid_key':
      body = `The Tacticus API key ${ownerLabel ? `added by ${ownerLabel} ` : ''}is no longer valid, so no new data has synced${sinceText}. Any guild member can fix this by adding a working Guild & Guild Raid API key.`
      break
    case 'no_key':
      body = `This guild has no Tacticus API key, so no new data has synced${sinceText}. Any guild member can fix this by adding a Guild & Guild Raid API key.`
      break
    case 'auto_sync_off':
      body = `Automatic sync is turned off for this guild, so no new data has synced${sinceText}. Any guild member can turn it back on by saving a working Guild & Guild Raid API key.`
      break
    case 'stale':
      body = date
        ? `No new data has synced since ${date}, although the API key is still marked valid. Saving the key again on the API Keys page re-checks it and starts a sync right away; if data still does not update after that, the problem is not your key.`
        : `No data has synced yet, although the API key is still marked valid. Saving the key again on the API Keys page re-checks it and starts a sync right away; if data still does not update after that, the problem is not your key.`
      break
  }

  const ctaText =
    incident.reason === 'stale' ? 'Check the API key' : 'Fix the API key'

  return (
    <div
      role="alert"
      aria-label="Guild data sync stopped"
      className="mb-6 rounded-lg border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-4 py-3"
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 text-sm text-[var(--text-primary)]">
          <h2 className="font-semibold">{heading}</h2>
          <p className="mt-1 text-[var(--text-secondary)]">{body}</p>
          <p className="mt-1 text-[var(--text-secondary)]">
            Raid stats and tokens on this site will not update until this is
            fixed.
          </p>
          <p className="mt-2">
            <Link
              href="/api-keys"
              className="font-semibold text-[var(--accent)] underline"
            >
              {ctaText}
            </Link>
          </p>
          {incident.viewerIsLeadership ? (
            <p className="mt-2 text-[var(--text-secondary)]">
              Leaders and officers: you can also review the key in{' '}
              <Link
                href="/guild-management/settings?tab=integrations"
                className="underline"
              >
                Guild Settings
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
