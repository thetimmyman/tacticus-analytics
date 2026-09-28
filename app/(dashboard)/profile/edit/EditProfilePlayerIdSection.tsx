'use client'

// The change needs a Guild-scope API key from the new account as proof; it becomes the stored key.

import type { Dispatch, SetStateAction } from 'react'

interface EditProfilePlayerIdSectionProps {
  initialProfile: { player_id: string }
  showPlayerIdChange: boolean
  setShowPlayerIdChange: Dispatch<SetStateAction<boolean>>
  newPlayerId: string
  setNewPlayerId: Dispatch<SetStateAction<string>>
  newAccountApiKey: string
  setNewAccountApiKey: Dispatch<SetStateAction<string>>
  savingPlayerId: boolean
  handlePlayerIdChange: () => Promise<void>
  playerIdError: string | null
  setPlayerIdError: Dispatch<SetStateAction<string | null>>
  playerIdSuccess: string | null
}

export function EditProfilePlayerIdSection({
  initialProfile,
  showPlayerIdChange,
  setShowPlayerIdChange,
  newPlayerId,
  setNewPlayerId,
  newAccountApiKey,
  setNewAccountApiKey,
  savingPlayerId,
  handlePlayerIdChange,
  playerIdError,
  setPlayerIdError,
  playerIdSuccess
}: EditProfilePlayerIdSectionProps) {
  return (
    <div className="mt-6 pt-6 border-t border-(--card-border)">
      <h3 className="text-lg font-medium text-primary-wh40k mb-4">Player ID</h3>

      <div className="space-y-4">
        <div className="bg-(--card-bg) border border-(--card-border) rounded-md p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-primary-wh40k">
                Current Player ID
              </p>
              <p className="mt-1 text-sm font-mono text-secondary-wh40k">
                {initialProfile.player_id || 'Not set'}
              </p>
            </div>
            {!showPlayerIdChange && (
              <button
                type="button"
                onClick={() => setShowPlayerIdChange(true)}
                className="btn-wh40k text-sm"
              >
                Change
              </button>
            )}
          </div>
        </div>

        {showPlayerIdChange && (
          <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-md p-4">
            <p className="text-sm text-yellow-200 mb-3">
              Moving your profile to a different Tacticus account requires proof
              you own the new account: an API key created on the new account
              with <strong>Guild scope</strong> (Guild scope is required —
              regenerate the key if yours only has Player scope). The new
              account must already appear on a synced guild roster, and you can
              only move your account once every 7 days.
            </p>
            <p className="text-xs text-yellow-200/80 mb-3">
              This key is separate from the stored API key below: on success it
              becomes the stored key for your moved profile.
            </p>
            <div className="space-y-2">
              <input
                type="text"
                value={newPlayerId}
                onChange={(e) => setNewPlayerId(e.target.value)}
                className="input-wh40k w-full font-mono"
                placeholder="Enter new Player ID"
                disabled={savingPlayerId}
              />
              <input
                type="password"
                value={newAccountApiKey}
                onChange={(e) => setNewAccountApiKey(e.target.value)}
                className="input-wh40k w-full font-mono"
                placeholder="New account's API key (Guild scope)"
                disabled={savingPlayerId}
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
              />
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={handlePlayerIdChange}
                  className="btn-accent-wh40k"
                  disabled={
                    savingPlayerId ||
                    !newPlayerId.trim() ||
                    !newAccountApiKey.trim()
                  }
                >
                  {savingPlayerId ? 'Verifying...' : 'Verify & Change'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPlayerIdChange(false)
                    setNewPlayerId('')
                    setNewAccountApiKey('')
                    setPlayerIdError(null)
                  }}
                  className="btn-wh40k"
                  disabled={savingPlayerId}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {playerIdError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <p className="text-sm text-red-400">{playerIdError}</p>
          </div>
        )}

        {playerIdSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3">
            <p className="text-sm text-emerald-400">{playerIdSuccess}</p>
          </div>
        )}
      </div>
    </div>
  )
}
