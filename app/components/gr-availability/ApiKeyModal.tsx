'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@tacticus/ui-kit'
import { CheckCircle, Key, RefreshCw, Trash } from 'lucide-react'
import { Modal } from '@/app/components/gr-availability/Modal'
import { StatusMessageIcon } from '@/app/components/gr-availability/StatusMessageIcon'
import {
  TACTICUS_SITE,
  type SaveStatusType,
  type StatusState
} from '@/app/components/gr-availability/types'

interface ApiKeyModalProps {
  showApiModal: boolean
  setShowApiModal: Dispatch<SetStateAction<boolean>>
  apiKey: string
  setApiKey: Dispatch<SetStateAction<string>>
  hasApiKey: boolean
  saveStatus: StatusState<SaveStatusType>
  savingKey: boolean
  deletingKey: boolean
  saveApiKey: () => Promise<void>
  deleteApiKey: () => Promise<void>
  lastSuccessfulSync: Date | null
  autoRefresh: boolean
}

export const ApiKeyModal = ({
  showApiModal,
  setShowApiModal,
  apiKey,
  setApiKey,
  hasApiKey,
  saveStatus,
  savingKey,
  deletingKey,
  saveApiKey,
  deleteApiKey,
  lastSuccessfulSync,
  autoRefresh
}: ApiKeyModalProps) => {
  return (
    <Modal isOpen={showApiModal} onClose={() => setShowApiModal(false)}>
      <div className="p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] mb-3 sm:mb-4">
          API Key Management
        </h3>

        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="modal-api-key-input"
              className="text-sm text-[var(--text-secondary)]"
            >
              Tacticus API Key
            </label>
            <input
              id="modal-api-key-input"
              type="text"
              placeholder={
                hasApiKey
                  ? 'Replace existing API key'
                  : 'Enter your Tacticus API key'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`w-full px-3 py-2 text-sm bg-[var(--bg-secondary)] border rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-all duration-300 ${
                saveStatus.type === 'error'
                  ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
                  : 'border-[var(--card-border)]'
              }`}
              disabled={savingKey || deletingKey}
            />
          </div>

          {/* Modal Status Message */}
          {saveStatus.type && (
            <div
              className={`
                px-3 py-2 rounded-md text-sm font-medium
                transition-all duration-300 animate-in fade-in slide-in-from-top-1
                ${
                  saveStatus.type === 'success'
                    ? 'bg-green-500/15 text-green-400 border border-green-500/25'
                    : saveStatus.type === 'error'
                      ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--accent)_25%,transparent)]'
                      : 'bg-[color-mix(in_srgb,var(--primary)_15%,transparent)] text-[var(--accent)] border border-[color-mix(in_srgb,var(--primary)_25%,transparent)]'
                }
	              `}
            >
              <div className="flex items-center gap-2">
                <StatusMessageIcon type={saveStatus.type} className="h-4 w-4" />
                <span>{saveStatus.message}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button
              onClick={saveApiKey}
              disabled={!apiKey.trim() || savingKey || deletingKey}
              size="md"
              className="w-full"
            >
              {savingKey ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span className="ml-2">Validating...</span>
                </>
              ) : (
                <>
                  <Key className="h-4 w-4" />
                  <span className="ml-2">
                    {hasApiKey ? 'Update Key' : 'Add Key'}
                  </span>
                </>
              )}
            </Button>

            {hasApiKey && (
              <Button
                onClick={deleteApiKey}
                disabled={deletingKey || savingKey}
                size="md"
                variant="outline"
                className="w-full hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-[var(--accent)] hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
              >
                {deletingKey ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span className="ml-2">Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash className="h-4 w-4" />
                    <span className="ml-2">Delete Key</span>
                  </>
                )}
              </Button>
            )}
          </div>

          {hasApiKey && !saveStatus.type && (
            <div className="text-xs text-green-400/70 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-start gap-2">
              <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                API key is saved and connected to live Tacticus data.
                {lastSuccessfulSync ? (
                  <span> Data synced successfully.</span>
                ) : (
                  <span> Click &quot;Sync&quot; to fetch live data.</span>
                )}
                {autoRefresh && <span> Auto-refresh is enabled.</span>}
              </span>
            </div>
          )}

          <div className="text-xs text-[var(--text-secondary)] border-t border-[var(--card-border)] pt-3">
            Get your API key from{' '}
            <a
              href={TACTICUS_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:text-[var(--primary)] underline"
            >
              {TACTICUS_SITE}
            </a>
          </div>
        </div>
      </div>
    </Modal>
  )
}
