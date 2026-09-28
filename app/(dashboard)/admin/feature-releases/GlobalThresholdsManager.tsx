'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import {
  Gauge,
  Edit2,
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  Save
} from 'lucide-react'

import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { RANK_SELECT_OPTIONS as RANKS } from '@/app/lib/tacticus/ranks'

interface GlobalThreshold {
  id: string
  rarity: string
  strength_level: string
  min_rank: string
  min_rank_index: number
  min_ability_active: number | null
  min_ability_passive: number | null
  notes: string | null
  updated_at: string
}

type EditingThreshold = Partial<GlobalThreshold>

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic']
const STRENGTH_LEVELS = ['Weak', 'Suitable', 'Strong', 'Optimal']

export function GlobalThresholdsManager() {
  const [thresholds, setThresholds] = useState<GlobalThreshold[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingData, setEditingData] = useState<EditingThreshold | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedRarity, setSelectedRarity] = useState<string>('Legendary')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch('/api/admin/global-thresholds')
      if (!res.ok) throw new Error('Failed to load thresholds')

      const data = await res.json()
      setThresholds(data.thresholds || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thresholds')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const startEditing = (threshold: GlobalThreshold) => {
    setEditingId(threshold.id)
    setEditingData({ ...threshold })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingData(null)
  }

  const saveThreshold = async () => {
    if (!editingId || !editingData) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/global-thresholds/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          min_rank: editingData.min_rank,
          min_rank_index: editingData.min_rank_index,
          min_ability_active: editingData.min_ability_active,
          min_ability_passive: editingData.min_ability_passive,
          notes: editingData.notes
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(extractErrorMessage(data, 'Failed to save threshold'))
      }

      setSuccess('Threshold updated successfully')
      setTimeout(() => setSuccess(null), 3000)
      setEditingId(null)
      setEditingData(null)
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save threshold')
    } finally {
      setSaving(false)
    }
  }

  const handleRankChange = (rankIndex: number) => {
    const rank = RANKS.find((r) => r.index === rankIndex)
    if (rank && editingData) {
      setEditingData({
        ...editingData,
        min_rank: rank.name,
        min_rank_index: rank.index
      })
    }
  }

  const filteredThresholds = thresholds.filter(
    (t) => t.rarity === selectedRarity
  )

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'Optimal':
        return 'text-green-400 bg-green-500/10 border-green-500/20'
      case 'Strong':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/20'
      case 'Suitable':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
      case 'Weak':
        return 'text-red-400 bg-red-500/10 border-red-500/20'
      default:
        return 'text-secondary-wh40k bg-gray-500/10 border-gray-500/20'
    }
  }

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'Common':
        return 'text-primary-wh40k'
      case 'Uncommon':
        return 'text-green-400'
      case 'Rare':
        return 'text-blue-400'
      case 'Epic':
        return 'text-purple-400'
      case 'Legendary':
        return 'text-amber-400'
      case 'Mythic':
        return 'text-red-400'
      default:
        return 'text-secondary-wh40k'
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-(--accent)" />
            Global Strength Thresholds
          </CardTitle>
          <p className="text-sm text-secondary-wh40k mt-1">
            Fallback thresholds used when no guild or cluster playbook
            requirements exist. These define minimum hero strength levels for
            boss assignments.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
              <Check className="h-4 w-4" />
              {success}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {RARITIES.map((rarity) => (
                <button
                  key={rarity}
                  onClick={() => setSelectedRarity(rarity)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedRarity === rarity
                      ? `${getRarityColor(rarity)} bg-(--card-bg) border border-current`
                      : 'text-secondary-wh40k hover:text-primary-wh40k hover:bg-(--card-bg)'
                  }`}
                >
                  {rarity}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-secondary-wh40k" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-(--card-border)">
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-wh40k">
                      Strength Level
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-wh40k">
                      Min Rank
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-wh40k">
                      Active Ability
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-wh40k">
                      Passive Ability
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-secondary-wh40k">
                      Notes
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-secondary-wh40k">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {STRENGTH_LEVELS.map((level) => {
                    const threshold = filteredThresholds.find(
                      (t) => t.strength_level === level
                    )
                    const isEditing = editingId === threshold?.id

                    if (!threshold) {
                      return (
                        <tr
                          key={level}
                          className="border-b border-card-border/50"
                        >
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-1 rounded-sm border text-xs font-medium ${getLevelColor(level)}`}
                            >
                              {level}
                            </span>
                          </td>
                          <td
                            colSpan={5}
                            className="py-3 px-4 text-sm text-secondary-wh40k"
                          >
                            Not configured
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr
                        key={threshold.id}
                        className="border-b border-card-border/50 hover:bg-card/50"
                      >
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-1 rounded-sm border text-xs font-medium ${getLevelColor(level)}`}
                          >
                            {level}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <select
                              value={
                                editingData?.min_rank_index ??
                                threshold.min_rank_index
                              }
                              onChange={(e) =>
                                handleRankChange(parseInt(e.target.value))
                              }
                              className="px-2 py-1 rounded-sm border border-(--card-border) bg-(--bg-primary) text-primary-wh40k text-sm"
                            >
                              {RANKS.map((rank) => (
                                <option key={rank.index} value={rank.index}>
                                  {rank.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm text-primary-wh40k">
                              {threshold.min_rank}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="60"
                              value={editingData?.min_ability_active ?? ''}
                              onChange={(e) =>
                                setEditingData({
                                  ...editingData,
                                  min_ability_active: e.target.value
                                    ? parseInt(e.target.value)
                                    : null
                                })
                              }
                              className="w-16 px-2 py-1 rounded-sm border border-(--card-border) bg-(--bg-primary) text-primary-wh40k text-sm"
                              placeholder="-"
                            />
                          ) : (
                            <span className="text-sm text-primary-wh40k">
                              {threshold.min_ability_active ?? '-'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="60"
                              value={editingData?.min_ability_passive ?? ''}
                              onChange={(e) =>
                                setEditingData({
                                  ...editingData,
                                  min_ability_passive: e.target.value
                                    ? parseInt(e.target.value)
                                    : null
                                })
                              }
                              className="w-16 px-2 py-1 rounded-sm border border-(--card-border) bg-(--bg-primary) text-primary-wh40k text-sm"
                              placeholder="-"
                            />
                          ) : (
                            <span className="text-sm text-primary-wh40k">
                              {threshold.min_ability_passive ?? '-'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editingData?.notes ?? ''}
                              onChange={(e) =>
                                setEditingData({
                                  ...editingData,
                                  notes: e.target.value || null
                                })
                              }
                              className="w-full px-2 py-1 rounded-sm border border-(--card-border) bg-(--bg-primary) text-primary-wh40k text-sm"
                              placeholder="Optional notes..."
                            />
                          ) : (
                            <span className="text-sm text-secondary-wh40k">
                              {threshold.notes || '-'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={cancelEditing}
                                disabled={saving}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={saveThreshold}
                                disabled={saving}
                              >
                                {saving ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditing(threshold)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm text-blue-300">
              <strong>How it works:</strong> When assigning a player to a boss,
              the system first looks for guild-specific playbook requirements,
              then cluster-level requirements. If neither exists, these global
              thresholds are used as a fallback to evaluate whether a
              player&apos;s roster meets the minimum strength requirements.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
