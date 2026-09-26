'use client'

import { useState, useEffect, useCallback } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { Button } from '@tacticus/ui-kit'
import Link from 'next/link'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.alerts.ApiKeyHealthBanner')
import { useClusterContext } from '@/app/hooks/useClusterContext'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import {
  AlertTriangle,
  Key,
  X,
  RefreshCw,
  CheckCircle,
  Clock,
  ExternalLink,
  Save,
  Loader2
} from 'lucide-react'

interface GuildApiStatus {
  has_api_key: boolean
  api_key_is_valid: boolean | null
  api_key_last_validated: string | null
  consecutive_sync_failures: number | null
  last_sync_attempt: string | null
  last_successful_sync: string | null
}

export function ApiKeyHealthBanner() {
  const { role, guildCode, isLoading: contextLoading } = useClusterContext()
  const [apiStatus, setApiStatus] = useState<GuildApiStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [retesting, setRetesting] = useState(false)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateSuccess, setUpdateSuccess] = useState(false)

  const supabase = dbClient()

  const fetchApiStatus = useCallback(
    async (guild: string) => {
      try {
        const { data, error } = await supabase
          .from('guild_config')
          .select(
            `
          api_key_is_valid,
          api_key_last_validated,
          consecutive_sync_failures,
          last_sync_attempt,
          last_successful_sync
        `
          )
          .eq('guild_code', guild)
          .single()

        if (!error && data) {
          setApiStatus({
            ...data,
            has_api_key:
              data.api_key_is_valid !== null ||
              data.api_key_last_validated !== null
          })
        }
      } catch (err) {
        logger.error({ err: err }, 'Failed to fetch API status:')
      } finally {
        setStatusLoading(false)
      }
    },
    [supabase]
  )

  useEffect(() => {
    if (!contextLoading && guildCode) {
      fetchApiStatus(guildCode)
    } else if (!contextLoading) {
      setStatusLoading(false)
    }
  }, [contextLoading, guildCode, fetchApiStatus])

  const testApiKey = async () => {
    if (!guildCode) return

    setRetesting(true)
    try {
      const response = await fetch('/api/guild/validate-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: guildCode })
      })

      if (response.ok) {
        await fetchApiStatus(guildCode)
      }
    } catch (err) {
      logger.error({ err: err }, 'Failed to validate API key:')
    } finally {
      setRetesting(false)
    }
  }

  const updateApiKey = async () => {
    if (!newApiKey.trim()) {
      setUpdateError('Please enter an API key')
      return
    }

    setUpdating(true)
    setUpdateError(null)
    setUpdateSuccess(false)

    try {
      const response = await fetch('/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: guildCode,
          api_key: newApiKey.trim()
        })
      })

      const result = await response.json()

      if (!response.ok) {
        setUpdateError(extractErrorMessage(result, 'Failed to update API key'))
        return
      }

      setUpdateSuccess(true)
      setNewApiKey('')
      setShowKeyInput(false)

      if (guildCode) {
        await fetchApiStatus(guildCode)
      }

      setTimeout(() => setUpdateSuccess(false), 5000)
    } catch (err) {
      logger.error({ err: err }, 'Failed to update API key:')
      setUpdateError('Network error - please try again')
    } finally {
      setUpdating(false)
    }
  }

  const loading = contextLoading || statusLoading

  if (loading || dismissed || !guildCode || !apiStatus) {
    return null
  }

  const getAlertInfo = () => {
    const isLeader = role === 'leader'
    const hasApiKey = apiStatus.has_api_key
    const isValid = apiStatus.api_key_is_valid
    const failures = apiStatus.consecutive_sync_failures || 0
    const lastValidated = apiStatus.api_key_last_validated
    const daysSinceValidation = lastValidated
      ? Math.floor(
          (Date.now() - new Date(lastValidated).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null

    if (!hasApiKey) {
      return {
        level: 'critical' as const,
        title: 'No API Key Configured',
        message:
          'Your guild data cannot sync without an API key. Any guild member can add a Guild & Guild Raid API key to enable data updates.',
        icon: <Key className="w-5 h-5" />
      }
    }

    if (isValid === false) {
      return {
        level: 'critical' as const,
        title: 'Invalid API Key',
        message: `The API key is invalid and data sync has failed ${failures} times. Any guild member can update the API key to restore synchronization.`,
        icon: <AlertTriangle className="w-5 h-5" />
      }
    }

    if (failures >= 3) {
      return {
        level: 'warning' as const,
        title: 'Sync Issues Detected',
        message: `Data synchronization has failed ${failures} times. The API key may need to be refreshed.`,
        icon: <RefreshCw className="w-5 h-5" />
      }
    }

    if (isLeader && daysSinceValidation && daysSinceValidation > 30) {
      return {
        level: 'warning' as const,
        title: 'API Key Needs Validation',
        message: `Your API key hasn't been validated in ${daysSinceValidation} days. Test it to ensure continued data sync.`,
        icon: <Clock className="w-5 h-5" />
      }
    }

    return null
  }

  const alertInfo = getAlertInfo()
  if (!alertInfo) return null

  const bgColor =
    alertInfo.level === 'critical'
      ? 'bg-red-900/20 border-red-500/50'
      : 'bg-yellow-900/20 border-yellow-500/50'

  const textColor =
    alertInfo.level === 'critical' ? 'text-red-300' : 'text-yellow-300'

  const iconColor =
    alertInfo.level === 'critical' ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className={`${bgColor} border rounded-lg p-4 mb-6 relative`}>
      <div className="flex items-start gap-4">
        <div className={iconColor}>{alertInfo.icon}</div>

        <div className="flex-1">
          <h3 className={`font-semibold ${textColor} mb-1`}>
            {alertInfo.title}
          </h3>
          <p className="text-sm text-[var(--text-primary)] mb-3">
            {alertInfo.message}
          </p>

          {updateSuccess && (
            <div className="flex items-center gap-2 text-green-400 text-sm mb-3">
              <CheckCircle className="w-4 h-4" />
              API key updated successfully! Guild sync triggered.
            </div>
          )}

          {showKeyInput ? (
            <div className="space-y-3">
              <div className="bg-yellow-900/30 border border-yellow-600/50 rounded p-2 mb-2">
                <p className="text-yellow-300 text-xs font-medium">
                  This requires a{' '}
                  <strong>Guild &amp; Guild Raid API key</strong> (NOT a Player
                  API key)
                </p>
                <ol className="text-yellow-200/70 text-xs mt-1 list-decimal list-inside space-y-0.5">
                  <li>
                    Go to{' '}
                    <a
                      href="https://api.tacticusgame.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-300 underline hover:text-yellow-200"
                    >
                      api.tacticusgame.com
                    </a>
                  </li>
                  <li>
                    Click &quot;Create New API Key&quot; with read access to:
                    Guild &amp; Guild Raid
                  </li>
                  <li>Copy and paste it below</li>
                </ol>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="Paste Guild & Guild Raid Leader API key here"
                  className="flex-1 px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                  disabled={updating}
                />
                <Button
                  size="sm"
                  variant="default"
                  onClick={updateApiKey}
                  disabled={updating || !newApiKey.trim()}
                >
                  {updating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowKeyInput(false)
                    setNewApiKey('')
                    setUpdateError(null)
                  }}
                  disabled={updating}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {updateError && (
                <p className="text-red-400 text-sm">
                  {updateError}
                  {updateError.includes('401') ||
                  updateError.includes('403') ||
                  updateError.includes('invalid') ? (
                    <span className="block mt-1 text-red-300">
                      Make sure you&apos;re using a Guild &amp; Guild Raid API
                      key, not a Player API key.
                    </span>
                  ) : null}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                size="sm"
                variant="default"
                onClick={() => setShowKeyInput(true)}
              >
                <Key className="w-4 h-4 mr-2" />
                {apiStatus.has_api_key ? 'Update API Key' : 'Add API Key'}
              </Button>

              {apiStatus.has_api_key && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={testApiKey}
                  disabled={retesting}
                >
                  {retesting ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  {retesting ? 'Testing...' : 'Test Now'}
                </Button>
              )}

              {role === 'leader' && (
                <Link href="/guild-management/settings?tab=integrations">
                  <Button size="sm" variant="ghost">
                    Full Settings
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          title="Dismiss until next page load"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
