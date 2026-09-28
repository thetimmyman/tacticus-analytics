'use client'

import type { Dispatch, SetStateAction } from 'react'
import { ClientDate, StatusLabel } from '@tacticus/ui-kit'
import { TACTICUS_API } from '@tacticus/app-core/app-config'

interface EditProfileApiKeySectionProps {
  hasExistingApiKey: boolean
  apiKeyIsValid: boolean
  apiKeyLastVerified: string
  savingApiKey: boolean
  apiKey: string
  setApiKey: Dispatch<SetStateAction<string>>
  handleApiKeySubmit: () => Promise<void>
  handleApiKeyRemove: () => Promise<void>
  apiKeyError: string | null
  apiKeySuccess: string | null
  tacticusSite: string
}

export function EditProfileApiKeySection({
  hasExistingApiKey,
  apiKeyIsValid,
  apiKeyLastVerified,
  savingApiKey,
  apiKey,
  setApiKey,
  handleApiKeySubmit,
  handleApiKeyRemove,
  apiKeyError,
  apiKeySuccess,
  tacticusSite
}: EditProfileApiKeySectionProps) {
  return (
    <div className="mt-6 pt-6 border-t border-(--card-border)">
      <h3 className="text-lg font-medium text-primary-wh40k mb-4">
        Tacticus Player API Key
      </h3>
      <p className="text-sm text-secondary-wh40k mb-4">
        Required to enable accurate tracking of your guild raid token
        availability
      </p>

      <div className="space-y-4">
        {/* Current Status */}
        {hasExistingApiKey && (
          <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-md p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-primary-wh40k">
                  API Key Status
                </p>
                <p className="mt-1 text-sm text-secondary-wh40k">
                  {apiKeyIsValid ? (
                    <StatusLabel type="success">Valid</StatusLabel>
                  ) : (
                    <StatusLabel type="info">Invalid</StatusLabel>
                  )}
                </p>
                {apiKeyLastVerified && (
                  <p className="mt-1 text-xs text-secondary-wh40k">
                    Last verified:{' '}
                    <ClientDate date={apiKeyLastVerified} format="full" />
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleApiKeyRemove}
                className="btn-wh40k text-sm"
                disabled={savingApiKey}
              >
                {savingApiKey ? 'Removing...' : 'Remove Key'}
              </button>
            </div>
          </div>
        )}

        {/* API Key Input */}
        {!hasExistingApiKey && (
          <div>
            <label
              htmlFor="apiKey"
              className="block text-sm font-medium text-secondary-wh40k"
            >
              Enter your Tacticus API Key
            </label>
            <div className="mt-1 flex space-x-2">
              <input
                id="apiKey"
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="input-wh40k flex-1 font-mono"
                placeholder="Your API key..."
                disabled={savingApiKey}
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
              />
              <button
                type="button"
                onClick={handleApiKeySubmit}
                className="btn-accent-wh40k"
                disabled={savingApiKey || !apiKey.trim()}
              >
                {savingApiKey ? 'Validating...' : 'Add Key'}
              </button>
            </div>
          </div>
        )}

        {/* Error/Success Messages for API Key */}
        {apiKeyError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <p className="text-sm text-red-400">{apiKeyError}</p>
          </div>
        )}

        {apiKeySuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3">
            <p className="text-sm text-emerald-400">{apiKeySuccess}</p>
          </div>
        )}

        {/* Help Text */}
        <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-md p-3">
          <p className="text-xs text-secondary-wh40k">
            <strong>How to get your API key:</strong>
          </p>
          <ol className="mt-2 text-xs text-secondary-wh40k list-decimal list-inside space-y-1">
            <li>
              Go to{' '}
              <a
                href={tacticusSite}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--accent) hover:text-(--primary) underline"
              >
                {TACTICUS_API.ORIGIN}
              </a>
            </li>
            <li>
              Click &quot;Create New API Key&quot; with read access to: Player
            </li>
            <li>Copy and paste it above</li>
          </ol>
          <p className="mt-2 text-xs text-yellow-400">
            Note: Your API key is used to track your token availability and
            provide real-time raid data. It&apos;s stored securely and never
            shared.
          </p>
        </div>
      </div>
    </div>
  )
}
