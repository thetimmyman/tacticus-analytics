'use client'

import { useCallback, useEffect, useState } from 'react'

interface ProgressionConfigRow {
  id: string
  scope: string
  game_version: string | null
  first_pass_sequence: string[]
  loop_sequence: string[]
  loop_start_stage: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export function RaidConfigPanel() {
  const [configs, setConfigs] = useState<ProgressionConfigRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/admin/progression-config')
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`)
      const data = await res.json()
      setConfigs(data.configs ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  const toggleActive = async (id: string, activate: boolean) => {
    try {
      setToggling(id)
      const res = await fetch('/api/admin/progression-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: activate })
      })
      if (!res.ok) throw new Error(`Failed to update: ${res.status}`)
      await loadConfigs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-xl font-bold text-primary-wh40k">
          Guild Raid Progression Overrides
        </h1>
        <div className="text-sm text-secondary-wh40k">Fetching config...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-xl font-bold text-primary-wh40k">
          Guild Raid Progression Overrides
        </h1>
        <div className="rounded-sm bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
        <button
          onClick={loadConfigs}
          className="mt-2 text-sm text-blue-400 underline"
        >
          Retry
        </button>
      </div>
    )
  }

  // The API already excludes retired rows; the client filter guards cached or bad responses.
  const guildConfigs = configs.filter((c) => c.scope !== 'global')

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold text-primary-wh40k">
        Guild Raid Progression Overrides
      </h1>
      <p className="mb-6 text-sm text-secondary-wh40k">
        Manage deliberate guild-specific escape hatches. Seasons without an
        override use the progression policy captured from the game config.
      </p>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-primary-wh40k">
          Guild Overrides
        </h2>
        <div className="space-y-3">
          {guildConfigs.length === 0 && (
            <div className="text-sm text-secondary-wh40k">
              No guild-specific overrides configured.
            </div>
          )}
          {guildConfigs.map((config) => (
            <ConfigCard
              key={config.id}
              config={config}
              toggling={toggling === config.id}
              onToggle={(activate) => toggleActive(config.id, activate)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function ConfigCard(props: {
  config: ProgressionConfigRow
  toggling: boolean
  onToggle: (activate: boolean) => void
}) {
  const { config, toggling, onToggle } = props

  return (
    <div
      className={`rounded-lg border p-4 ${
        config.is_active
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-(--border-primary) bg-(--bg-secondary)'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary-wh40k">
              {config.game_version ?? 'Unknown'} — {config.scope}
            </span>
            {config.is_active && (
              <span className="rounded-sm bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                ACTIVE
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-secondary-wh40k">
            First pass: {config.first_pass_sequence.join(' \u2192 ')}
          </div>
          <div className="text-xs text-secondary-wh40k">
            Loop: {config.loop_sequence.join(' \u2192 ')} (starts at{' '}
            {config.loop_start_stage})
          </div>
        </div>
        <button
          onClick={() => onToggle(!config.is_active)}
          disabled={toggling}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            config.is_active
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
          } disabled:opacity-50`}
        >
          {toggling ? '...' : config.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
  )
}
