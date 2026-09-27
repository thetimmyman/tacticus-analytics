'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@tacticus/ui-kit'
import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Key,
  RefreshCw,
  Settings,
  Trash
} from 'lucide-react'
import { StatusMessageIcon } from '@/app/components/gr-availability/StatusMessageIcon'
import {
  TACTICUS_SITE,
  type SaveStatusType,
  type StatusState
} from '@/app/components/gr-availability/types'

interface ApiKeyPanelProps {
  setShowApiModal: Dispatch<SetStateAction<boolean>>
  hasApiKey: boolean
  apiKey: string
  setApiKey: Dispatch<SetStateAction<string>>
  saveStatus: StatusState<SaveStatusType>
  savingKey: boolean
  deletingKey: boolean
  saveApiKey: () => Promise<void>
  deleteApiKey: () => Promise<void>
  lastSuccessfulSync: Date | null
  autoRefresh: boolean
  showHowItWorks: boolean
  setShowHowItWorks: Dispatch<SetStateAction<boolean>>
}

export const ApiKeyPanel = ({
  setShowApiModal,
  hasApiKey,
  apiKey,
  setApiKey,
  saveStatus,
  savingKey,
  deletingKey,
  saveApiKey,
  deleteApiKey,
  lastSuccessfulSync,
  autoRefresh,
  showHowItWorks,
  setShowHowItWorks
}: ApiKeyPanelProps) => {
  return (
    <div className="mt-3 space-y-2">
      <div className="space-y-2">
        {/* Mobile-optimized API key management with modal option */}
        <div className="block sm:hidden">
          {/* Mobile: Single button that opens modal */}
          <Button
            onClick={() => setShowApiModal(true)}
            size="sm"
            variant="outline"
            className="w-full h-8 px-3"
          >
            <Settings className="h-3 w-3" />
            <span className="ml-2 text-xs">
              {hasApiKey ? 'Manage API Key' : 'Add API Key'}
            </span>
            {hasApiKey && <Check className="ml-1 h-3 w-3 text-green-400" />}
          </Button>
        </div>

        <div className="hidden sm:block">
          {/* Desktop: Full inline form */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              id="api-key-input"
              type="text"
              placeholder={
                hasApiKey ? 'Replace existing API key' : 'Add Tacticus API key'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`flex-1 px-2 py-1 text-xs bg-[var(--card-bg)] border rounded text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition-all duration-300 ${
                saveStatus.type === 'error'
                  ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
                  : 'border-[var(--card-border)]'
              }`}
              disabled={savingKey || deletingKey}
            />
            <div className="flex items-center gap-2 sm:flex-shrink-0">
              <Button
                onClick={saveApiKey}
                disabled={!apiKey.trim() || savingKey || deletingKey}
                size="sm"
                className="h-7 px-3 flex-1 sm:flex-initial"
              >
                {savingKey ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    <span className="ml-1 text-xs">Validating</span>
                  </>
                ) : (
                  <>
                    <Key className="h-3 w-3" />
                    <span className="ml-1 text-xs">
                      {hasApiKey ? 'Update' : 'Add'}
                    </span>
                  </>
                )}
              </Button>
              {hasApiKey && (
                <Button
                  onClick={deleteApiKey}
                  disabled={deletingKey || savingKey}
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-[var(--accent)] hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)] flex-1 sm:flex-initial"
                >
                  {deletingKey ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span className="ml-1 text-xs">Deleting</span>
                    </>
                  ) : (
                    <>
                      <Trash className="h-3 w-3" />
                      <span className="ml-1 text-xs">Delete Key</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Inline status message below input */}
        {saveStatus.type && (
          <div
            className={`
                    px-3 py-2 rounded-md text-xs font-medium
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
              <StatusMessageIcon type={saveStatus.type} />
              <span>{saveStatus.message}</span>
            </div>
          </div>
        )}

        {hasApiKey && !saveStatus.type && (
          <div className="text-[10px] text-green-400/70 flex items-start gap-1">
            <CheckCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              API key is saved and connected to live Tacticus data.
              {lastSuccessfulSync ? (
                <span> Data synced successfully.</span>
              ) : (
                <span> Click &quot;Sync&quot; to fetch live data.</span>
              )}
              {autoRefresh && (
                <span> • Auto-refresh enabled (syncs every minute)</span>
              )}
            </span>
          </div>
        )}

        {/* Instructional text below the API key form */}
        <div className="text-[10px] text-[var(--text-tertiary)]">
          Add your Player API key for real-time accuracy from{' '}
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

      {/* Collapsible "How Token Tracking Works" section */}
      <div className="mt-3 p-3 bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-card-border/20">
        <button
          onClick={() => setShowHowItWorks(!showHowItWorks)}
          className="w-full flex items-center justify-between text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
        >
          <span>How Token Tracking Works</span>
          {showHowItWorks ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        {showHowItWorks && (
          <ul className="text-[10px] text-[var(--text-tertiary)] space-y-0.5 mt-2">
            <li>• Players start each season with 2 tokens</li>
            <li>• Tokens regenerate 1 every 12 hours (max 3)</li>
            <li>• Season cap is 28 tokens total</li>
            <li>• Bombs have an 18-hour cooldown</li>
            <li>• Capped status indicates wasted regeneration</li>
            <li>
              • API key status indicates whether a player has uploaded their key
              (golden = synced)
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
