'use client'

import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { useState, useEffect, useCallback } from 'react'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { BossLink } from '@/app/components/ui/BossLink'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.BossFavorites')

interface BossMapping {
  id: number
  boss_type: string
  encounter_index: number
  boss_name: string
}

interface BossGroup {
  mainBoss: string
  displayName: string
  sideBosses: Array<{
    name: string
    encounterIndex: number
  }>
}

interface BossFavoritesProps {
  playerId: string
  guildCode: string
  currentPreferences?: Record<string, string>
  onUpdate?: (preferences: Record<string, string>) => void
}

const PREFERENCE_OPTIONS = [
  {
    value: 'preferred',
    label: 'Preferred',
    emoji: 'P',
    color: 'text-(--success)',
    bgColor: 'bg-(--success-bg)',
    borderColor: 'border-(--success-border)'
  },
  {
    value: 'neutral',
    label: 'Neutral',
    emoji: 'N',
    color: 'text-secondary-wh40k',
    bgColor: 'bg-(--card-bg)',
    borderColor: 'border-(--card-border)'
  },
  {
    value: 'avoid',
    label: 'Avoid',
    emoji: 'A',
    color: 'text-(--error)',
    bgColor: 'bg-(--error-bg)',
    borderColor: 'border-(--error-border)'
  }
] as const

function PreferenceToggle({
  value,
  onChange,
  size = 'normal'
}: {
  value: string
  onChange: (value: string) => void
  size?: 'normal' | 'small'
}) {
  const buttonSize = size === 'small' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'
  const groupSize = size === 'small' ? 'gap-0.5' : 'gap-1'

  return (
    <div className={`flex ${groupSize}`}>
      {PREFERENCE_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`
            ${buttonSize} rounded flex items-center justify-center
            transition-all duration-200 border
            ${
              value === option.value
                ? `${option.bgColor} ${option.borderColor} ${option.color} scale-110`
                : 'bg-black/20 border-(--card-border) hover:border-(--text-secondary) opacity-50 hover:opacity-75'
            }
          `}
          title={option.label}
        >
          {option.emoji}
        </button>
      ))}
    </div>
  )
}

export default function BossFavorites({
  playerId,
  guildCode,
  currentPreferences = {},
  onUpdate
}: BossFavoritesProps) {
  const desktopMode = process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop'
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bossGroups, setBossGroups] = useState<BossGroup[]>([])
  const [preferences, setPreferences] =
    useState<Record<string, string>>(currentPreferences)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const fetchBossData = useCallback(async () => {
    try {
      const supabase = dbClient()
      const { data: bossMappings, error } = await supabase
        .from('boss_mapping')
        .select('*')
        .order('boss_type')

      if (error) throw error

      const groupedBosses = new Map<string, BossGroup>()

      bossMappings?.forEach((boss: BossMapping) => {
        if (!groupedBosses.has(boss.boss_type)) {
          groupedBosses.set(boss.boss_type, {
            mainBoss: boss.boss_type,
            displayName: boss.boss_type,
            sideBosses: []
          })
        }

        const group = groupedBosses.get(boss.boss_type)!
        group.sideBosses.push({
          name: boss.boss_name,
          encounterIndex: boss.encounter_index
        })
      })

      const sortedGroups = Array.from(groupedBosses.values()).sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      )

      sortedGroups.forEach((group) => {
        group.sideBosses.sort((a, b) => a.encounterIndex - b.encounterIndex)
      })

      setBossGroups(sortedGroups)
    } catch (error) {
      logger.error({ err: error }, 'Error fetching boss data:')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPlayerPreferences = useCallback(async () => {
    try {
      const supabase = dbClient()
      const query = desktopMode
        ? supabase
            .from(CURRENT_USER_PLAYER_MAPPING)
            .select('boss_preferences')
            .eq('guild_code', guildCode)
            .eq('is_current', true)
        : guildRosterQuery(supabase, guildCode, 'boss_preferences')
      const { data, error } = await query.eq('player_id', playerId).single()

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows.
        throw error
      }

      if (data?.boss_preferences) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setPreferences(data.boss_preferences as any)
      }
    } catch (error) {
      logger.error({ err: error }, 'Error loading player preferences:')
    }
  }, [playerId, guildCode, desktopMode])

  useEffect(() => {
    fetchBossData()
    if (!currentPreferences || Object.keys(currentPreferences).length === 0) {
      loadPlayerPreferences()
    }
  }, [playerId, guildCode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentPreferences && Object.keys(currentPreferences).length > 0) {
      setPreferences(currentPreferences)
    }
  }, [currentPreferences])

  const handlePreferenceChange = (bossId: string, preference: string) => {
    const newPreferences = { ...preferences }

    if (preference === 'neutral') {
      delete newPreferences[bossId]
    } else {
      newPreferences[bossId] = preference
    }

    setPreferences(newPreferences)
    setHasChanges(true)
  }

  const savePreferences = async () => {
    if (!hasChanges) return

    setSaving(true)
    setSaveError(null)
    try {
      const supabase = dbClient()
      const update = supabase
        .from(desktopMode ? CURRENT_USER_PLAYER_MAPPING : 'player_mapping')
        .update({
          boss_preferences: preferences,
          ...(desktopMode
            ? {}
            : { preferences_updated_at: new Date().toISOString() })
        })
        .eq('player_id', playerId)
        .eq('guild_code', guildCode)
        .eq('is_current', true)
      const { data, error } = desktopMode
        ? await update.select('boss_preferences')
        : await update

      if (error) throw error
      if (desktopMode && data?.length !== 1)
        throw new Error('Local preference update refused')

      if (onUpdate) {
        onUpdate(preferences)
      }

      setHasChanges(false)
      setSaveSuccess(true)

      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      logger.error({ err: error }, 'Error saving preferences:')
      setSaveError(
        'Your boss preferences could not be saved. Your changes are still here; please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const resetPreferences = () => {
    setPreferences({})
    setHasChanges(true)
  }

  const getPreferenceStats = () => {
    let preferred = 0
    let avoided = 0
    Object.values(preferences).forEach((pref) => {
      if (pref === 'preferred') preferred++
      if (pref === 'avoid') avoided++
    })
    return { preferred, avoided }
  }

  const exportPreferences = () => {
    const exportData = {
      playerId,
      guildCode,
      preferences,
      exportedAt: new Date().toISOString(),
      bossCount: Object.keys(preferences).length
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `boss-preferences-${playerId}-${guildCode}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="card-wh40k p-6">
        <div className="flex items-center space-x-2 mb-4">
          <div className="w-6 h-6 bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] animate-pulse rounded-sm"></div>
          <div className="w-32 h-5 bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] animate-pulse rounded-sm"></div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-full h-20 bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] animate-pulse rounded-sm"
            ></div>
          ))}
        </div>
      </div>
    )
  }

  const stats = getPreferenceStats()

  return (
    <div className="card-wh40k p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-linear-to-r from-(--primary) to-(--accent) rounded-lg flex items-center justify-center">
            <span className="text-(--bg-primary) font-bold text-sm">B</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-accent-wh40k">
              Boss Preferences
            </h3>
            <p className="text-sm text-secondary-wh40k">
              Set your preferences for raid bosses and sub-bosses
            </p>
          </div>
        </div>

        {/* Stats & Export */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          <div className="flex items-center space-x-2 sm:space-x-3 text-sm">
            <span className="flex items-center space-x-1">
              <span className="text-green-400">Preferred</span>
              <span className="text-primary-wh40k">{stats.preferred}</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="text-red-400">Avoid</span>
              <span className="text-primary-wh40k">{stats.avoided}</span>
            </span>
          </div>

          <button
            onClick={exportPreferences}
            className="px-2 py-1 text-xs text-secondary-wh40k hover:text-primary-wh40k border border-(--card-border) rounded-sm transition-colors"
            title="Export preferences as JSON"
          >
            <span className="hidden sm:inline">Export</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-(--error) mb-4">
          {saveError}
        </p>
      )}
      {/* Boss Groups */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
        {bossGroups.map((group) => (
          <div
            key={group.mainBoss}
            className="border border-(--card-border) rounded-lg p-2 sm:p-3 bg-black/20"
          >
            {/* Main Boss Header */}
            <div className="border-b border-(--card-border) pb-1.5 sm:pb-2 mb-1.5 sm:mb-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-primary-wh40k flex items-center space-x-1">
                  <span className="text-xs">VS</span>
                  <span className="truncate">
                    <BossLink bossName={group.displayName}>
                      {getBossDisplayName(group.displayName)}
                    </BossLink>
                  </span>
                </h4>
                <PreferenceToggle
                  value={preferences[`main_${group.mainBoss}`] || 'neutral'}
                  onChange={(value) =>
                    handlePreferenceChange(`main_${group.mainBoss}`, value)
                  }
                  size="small"
                />
              </div>
            </div>

            {/* Sub-bosses - Single column */}
            <div className="space-y-0.5 sm:space-y-1">
              {group.sideBosses.map((sideBoss) => {
                // side_ prefix for primes (encounter index 1 and 2).
                const bossId =
                  sideBoss.encounterIndex > 0
                    ? `side_${sideBoss.name}`
                    : `main_${sideBoss.name}`
                const currentPref = preferences[bossId] || 'neutral'

                return (
                  <div
                    key={bossId}
                    className="flex items-center justify-between py-1 px-1 hover:bg-black/30 rounded-sm"
                  >
                    <span className="text-secondary-wh40k text-xs flex items-center space-x-1 min-w-0 flex-1 mr-1">
                      <span className="text-[color-mix(in_srgb,var(--text-primary)_40%,transparent)] shrink-0">
                        {sideBoss.encounterIndex > 0
                          ? 'Prime'
                          : `E${sideBoss.encounterIndex}`}
                      </span>
                      <span className="truncate">
                        <BossLink bossName={sideBoss.name}>
                          {/* Only the main encounter's raw boss_type needs the resolver; primes hold real names. */}
                          {sideBoss.encounterIndex > 0
                            ? sideBoss.name
                            : getBossDisplayName(sideBoss.name)}
                        </BossLink>
                      </span>
                    </span>

                    <PreferenceToggle
                      value={currentPref}
                      onChange={(value) =>
                        handlePreferenceChange(bossId, value)
                      }
                      size="small"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 pt-3 sm:pt-4 border-t border-(--card-border)">
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={resetPreferences}
            className="px-4 py-2 text-sm text-secondary-wh40k hover:text-primary-wh40k transition-colors"
            disabled={saving}
          >
            Reset All
          </button>

          <span className="text-xs text-secondary-wh40k">
            {desktopMode
              ? 'Saved in this workspace'
              : 'Saved with your profile'}
          </span>
        </div>

        <div className="flex items-center space-x-3">
          {hasChanges && !saveSuccess && (
            <span className="text-xs text-accent-wh40k">Unsaved changes</span>
          )}
          {saveSuccess && (
            <span className="text-green-400 text-sm font-medium">
              Saved successfully
            </span>
          )}
          <button
            onClick={savePreferences}
            disabled={!hasChanges || saving}
            className={`px-4 py-2 rounded text-sm font-medium transition-all ${
              hasChanges && !saving
                ? 'bg-linear-to-r from-(--primary) to-(--accent) text-(--bg-primary) hover:brightness-110'
                : 'bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)] cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-(--card-border)">
        <p className="text-xs text-secondary-wh40k mb-2">Preference Guide:</p>
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="flex items-center space-x-1">
            <span className="text-green-400">Preferred</span>
            <span className="text-secondary-wh40k">
              Preferred - Bosses you enjoy fighting
            </span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="text-secondary-wh40k">Neutral</span>
            <span className="text-secondary-wh40k">
              Neutral - No strong preference
            </span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="text-red-400">Avoid</span>
            <span className="text-secondary-wh40k">
              Avoid - Bosses you&apos;d rather not fight
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
