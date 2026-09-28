'use client'

import { useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('api-keys.ApiKeyManagementClient')
import { StatusLabel } from '@tacticus/ui-kit'
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { formatRelativeTime } from '@/app/lib/utils/date-format'

interface GuildConfig {
  id: number
  guild_code: string
  display_name: string
  has_api_key: boolean
  API_Owner?: string | null
  api_key_is_valid: boolean | null
  enabled: boolean | null
  updated_at: string | null
  api_key_last_validated: string | null
}

interface ApiKeyManagementClientProps {
  initialConfig: GuildConfig
  /** Officer/leader only (enforced server-side); hides a remove control that would 403. */
  canRemove: boolean
}

export default function ApiKeyManagementClient({
  initialConfig,
  canRemove
}: ApiKeyManagementClientProps) {
  const hasMounted = useHasMounted()
  const [guildConfig, setGuildConfig] = useState<GuildConfig>(initialConfig)
  const [showApiKey, setShowApiKey] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Removal breaks sync for the whole guild, so it needs confirmation.
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const tacticusSite = `${TACTICUS_API.ORIGIN}/`

  // Hydration-safe: SSR renders "—"; locale/now-dependent formatting runs after mount.
  const lastVerifiedDisplay = !guildConfig.api_key_last_validated
    ? 'Never'
    : !hasMounted
      ? '—'
      : `Last verified ${formatRelativeTime(guildConfig.api_key_last_validated, Date.now())}`

  // Hoisted out of JSX so the eslint-disable stays adjacent after Prettier.
  let lastUpdatedDisplay: string
  if (!guildConfig.updated_at) {
    lastUpdatedDisplay = 'Never'
  } else if (!hasMounted) {
    lastUpdatedDisplay = '—'
  } else {
    // eslint-disable-next-line no-restricted-syntax -- guarded by hasMounted above
    lastUpdatedDisplay = new Date(guildConfig.updated_at).toLocaleString()
  }

  // Requires a non-empty key; on failure the old key is kept server-side.
  const handleReplace = async () => {
    if (!newApiKey.trim()) {
      setError('Paste a key into the field before clicking Replace + Verify.')
      return
    }
    setReplacing(true)
    setError(null)
    setSuccess(false)
    try {
      const response = await fetch('/api/guild/replace-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: guildConfig.guild_code,
          api_key: newApiKey
        })
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        details?: string
        recommendation?: string
        success?: boolean
        verified_at?: string
      }
      if (!response.ok || !payload.success) {
        const message = [payload.error, payload.details, payload.recommendation]
          .filter(Boolean)
          .join(' — ')
        throw new Error(message || 'Replace + Verify failed')
      }
      setGuildConfig({
        ...guildConfig,
        has_api_key: true,
        api_key_is_valid: true,
        api_key_last_validated: payload.verified_at ?? new Date().toISOString(),
        updated_at: payload.verified_at ?? new Date().toISOString()
      })
      setNewApiKey('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      logger.error({ err }, 'replace-api-key failed')
      setError(err instanceof Error ? err.message : 'Replace + Verify failed')
    } finally {
      setReplacing(false)
    }
  }

  // `keyOverride` avoids a stale closure that could make Remove save a typed key.
  const handleSave = async (keyOverride?: string | null) => {
    const keyToSave = keyOverride === undefined ? newApiKey : keyOverride
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      // The route handles encryption; removal is an explicit flag (it rejects api_key: null).
      const response = await fetch('/api/guild/update-api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          keyToSave
            ? { guild_code: guildConfig.guild_code, api_key: keyToSave }
            : { guild_code: guildConfig.guild_code, remove: true }
        )
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage =
          typeof errorData.error === 'string'
            ? errorData.error
            : errorData.error?.message || 'Failed to update API key'
        throw new Error(errorMessage)
      }

      setGuildConfig({
        ...guildConfig,
        has_api_key: !!keyToSave,
        ...(keyToSave
          ? {}
          : { api_key_is_valid: null, api_key_last_validated: null }),
        updated_at: new Date().toISOString()
      })
      setNewApiKey('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      logger.error({ err: err }, 'API key update failed:')
      const enhancedError = createError(
        'API_KEY_SAVE_FAILED',
        err instanceof Error ? err.message : 'Failed to update API key',
        {
          component: 'ApiKeyManagementClient',
          action: 'save_api_key',
          guildCode: guildConfig.guild_code
        },
        err
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-primary-wh40k">
          API Key Management
        </h1>
        <p className="mt-2 text-secondary-wh40k">
          Manage the API key for{' '}
          {formatGuildDisplayLabel(
            {
              display_name: guildConfig.display_name,
              guild_code: guildConfig.guild_code
            },
            guildConfig.guild_code
          )}
        </p>
      </div>

      <div className="card-wh40k p-6 space-y-6">
        {/* Warning Banner */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-4">
          <div className="flex">
            <div className="shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-400">
                Important Security Notice
              </h3>
              <div className="mt-2 text-sm text-secondary-wh40k">
                <ul className="list-disc list-inside space-y-1">
                  <li>Keep your API key secure and never share it publicly</li>
                  <li>This key provides access to your guild&apos;s data</li>
                  <li>If compromised, regenerate your key immediately</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3">
            <p className="text-sm text-emerald-400">
              API key updated successfully!
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <StatusLabel type="error">
              <LinkifiedText text={error} />
            </StatusLabel>
          </div>
        )}

        {/* API Key Input */}
        <div>
          <label
            htmlFor="apiKey"
            className="block text-sm font-medium text-secondary-wh40k mb-2"
          >
            Guild API Key
          </label>
          <div className="relative">
            <input
              id="apiKey"
              type={showApiKey ? 'text' : 'password'}
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              className="input-wh40k w-full pr-10"
              placeholder="Enter your guild's API key"
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-secondary-wh40k hover:text-primary-wh40k"
            >
              {showApiKey ? (
                <EyeSlashIcon className="h-5 w-5" />
              ) : (
                <EyeIcon className="h-5 w-5" />
              )}
            </button>
          </div>
          <p className="mt-2 text-xs text-secondary-wh40k">
            Get your API key from{' '}
            <a
              href={tacticusSite}
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--accent) hover:text-(--primary) underline"
            >
              {TACTICUS_API.ORIGIN}
            </a>
          </p>
          {/* Live "Last verified X ago" anchor, recomputed on each render. */}
          <p
            className="mt-1 text-xs text-(--text-tertiary)"
            data-testid="last-verified-display"
          >
            {lastVerifiedDisplay}
          </p>
        </div>

        {/* Guild Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-(--card-border)">
          <div>
            <dt className="text-sm font-medium text-secondary-wh40k">
              Guild Status
            </dt>
            <dd className="mt-1">
              {guildConfig.enabled ? (
                <StatusLabel type="success">Active</StatusLabel>
              ) : (
                <StatusLabel type="error">Inactive</StatusLabel>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-secondary-wh40k">
              Last Updated
            </dt>
            <dd className="mt-1 text-sm text-primary-wh40k">
              {lastUpdatedDisplay}
            </dd>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-(--card-border)">
          {/* Removal is officer+ server-side; hide, don't 403. */}
          {canRemove && (
            <button
              type="button"
              onClick={() => setConfirmRemoveOpen(true)}
              className="btn-wh40k"
              disabled={saving || replacing || !guildConfig.has_api_key}
            >
              Remove API Key
            </button>
          )}
          {/* Replace + Verify: disabled until a key is pasted; failure keeps the old key. */}
          <button
            type="button"
            onClick={handleReplace}
            className="btn-wh40k"
            disabled={saving || replacing || !newApiKey.trim()}
            data-testid="replace-verify-button"
          >
            {replacing ? 'Verifying…' : 'Replace + Verify'}
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            className="btn-accent-wh40k"
            disabled={saving || replacing || !newApiKey}
          >
            {saving ? 'Saving...' : 'Save API Key'}
          </button>
        </div>
      </div>

      {canRemove && (
        <ConfirmDialog
          open={confirmRemoveOpen}
          tone="danger"
          title="Remove the guild API key?"
          description={`Roster and raid sync for ${formatGuildDisplayLabel({ display_name: guildConfig.display_name, guild_code: guildConfig.guild_code })} will stop until a new key is saved. This cannot be undone.`}
          confirmLabel="Remove key"
          busyLabel="Removing..."
          busy={saving}
          onCancel={() => setConfirmRemoveOpen(false)}
          onConfirm={async () => {
            await handleSave(null)
            setConfirmRemoveOpen(false)
          }}
        />
      )}

      {/* Help Section */}
      <div className="card-wh40k p-6">
        <h2 className="text-lg font-semibold text-primary-wh40k mb-4">
          How to Get Your API Key
        </h2>
        <ol className="space-y-3 text-sm text-secondary-wh40k">
          <li className="flex">
            <span className="shrink-0 w-6 h-6 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent) rounded-full flex items-center justify-center text-xs font-medium mr-3">
              1
            </span>
            <span>
              Visit{' '}
              <a
                href={tacticusSite}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--accent) hover:text-(--primary) underline"
              >
                {TACTICUS_API.ORIGIN}
              </a>
            </span>
          </li>
          <li className="flex">
            <span className="shrink-0 w-6 h-6 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent) rounded-full flex items-center justify-center text-xs font-medium mr-3">
              2
            </span>
            <span>Sign in with your game account</span>
          </li>
          <li className="flex">
            <span className="shrink-0 w-6 h-6 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent) rounded-full flex items-center justify-center text-xs font-medium mr-3">
              3
            </span>
            <span>Generate or copy your Guild API Key</span>
          </li>
          <li className="flex">
            <span className="shrink-0 w-6 h-6 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-(--accent) rounded-full flex items-center justify-center text-xs font-medium mr-3">
              4
            </span>
            <span>Paste it in the field above and click Save</span>
          </li>
        </ol>
      </div>
    </div>
  )
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  )
}

function EyeSlashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  )
}
