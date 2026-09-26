'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Loader2,
  Globe
} from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell
} from '@/app/components/RechartsWrapper'
import { dbClient } from '@/app/lib/db/client'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import type { PlayerRole } from '@tacticus/app-core/types'
import type { Boss } from './types'

interface HourlyData {
  hour_of_day: number
  battle_count: number
  percentage: number
}

interface RarityData {
  rarity: string
  battle_count: number
}

const RARITY_ORDER = [
  'Mythic',
  'Legendary',
  'Epic',
  'Rare',
  'Uncommon',
  'Common'
]

const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC', offset: 0 },
  { value: 'America/New_York', label: 'EST/EDT (New York)', offset: -5 },
  { value: 'America/Chicago', label: 'CST/CDT (Chicago)', offset: -6 },
  { value: 'America/Denver', label: 'MST/MDT (Denver)', offset: -7 },
  { value: 'America/Los_Angeles', label: 'PST/PDT (Los Angeles)', offset: -8 },
  { value: 'Europe/London', label: 'GMT/BST (London)', offset: 0 },
  { value: 'Europe/Paris', label: 'CET/CEST (Paris)', offset: 1 },
  { value: 'Europe/Berlin', label: 'CET/CEST (Berlin)', offset: 1 },
  { value: 'Europe/Moscow', label: 'MSK (Moscow)', offset: 3 },
  { value: 'Asia/Dubai', label: 'GST (Dubai)', offset: 4 },
  { value: 'Asia/Kolkata', label: 'IST (India)', offset: 5.5 },
  { value: 'Asia/Singapore', label: 'SGT (Singapore)', offset: 8 },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo)', offset: 9 },
  { value: 'Australia/Sydney', label: 'AEST/AEDT (Sydney)', offset: 10 },
  { value: 'Pacific/Auckland', label: 'NZST/NZDT (Auckland)', offset: 12 }
]

function getTimezoneOffset(timezone: string): number {
  try {
    const now = new Date()
    // eslint-disable-next-line no-restricted-syntax -- used for timezone calculation, not rendering
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' })
    // eslint-disable-next-line no-restricted-syntax -- used for timezone calculation, not rendering
    const tzStr = now.toLocaleString('en-US', { timeZone: timezone })
    const utcDate = new Date(utcStr)
    const tzDate = new Date(tzStr)
    const diffHours = (tzDate.getTime() - utcDate.getTime()) / 3600000
    return Math.round(diffHours * 2) / 2
  } catch {
    const found = TIMEZONE_OPTIONS.find((tz) => tz.value === timezone)
    return found?.offset ?? 0
  }
}

interface PlayerActivityChartProps {
  guildCode: string
  season?: string
  members: Array<{ display_name: string; role?: PlayerRole | null }>
  metaTeams: Array<{ team_name: string; display_name: string }>
  availableBosses?: Boss[]
  userTimezone?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function PlayerActivityChart({
  guildCode,
  season,
  members,
  metaTeams,
  availableBosses = [],
  userTimezone
}: PlayerActivityChartProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<HourlyData[]>([])
  const [error, setError] = useState<string | null>(null)

  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [selectedMetaTeam, setSelectedMetaTeam] = useState<string>('')
  const [selectedBoss, setSelectedBoss] = useState<string>('')
  const [availableRarities, setAvailableRarities] = useState<RarityData[]>([])
  const [selectedRarities, setSelectedRarities] = useState<string[]>([])
  const [raritiesInitialized, setRaritiesInitialized] = useState(false)

  const [selectedTimezone, setSelectedTimezone] = useState(
    userTimezone || 'UTC'
  )
  const [savingTimezone, setSavingTimezone] = useState(false)

  const uniqueRoles = useMemo(() => {
    const roles = new Set<string>()
    members.forEach((m) => {
      if (m.role) roles.add(m.role)
    })
    return Array.from(roles).sort()
  }, [members])

  const timezoneOffset = useMemo(
    () => getTimezoneOffset(selectedTimezone),
    [selectedTimezone]
  )

  const timezoneLabel = useMemo(() => {
    const offsetStr =
      timezoneOffset >= 0 ? `+${timezoneOffset}` : `${timezoneOffset}`
    return `UTC${offsetStr}`
  }, [timezoneOffset])

  const adjustedData = useMemo(() => {
    if (timezoneOffset === 0) return data

    return data
      .map((item) => {
        let adjustedHour = item.hour_of_day + timezoneOffset
        if (adjustedHour < 0) adjustedHour += 24
        if (adjustedHour >= 24) adjustedHour -= 24
        return { ...item, hour_of_day: adjustedHour }
      })
      .sort((a, b) => a.hour_of_day - b.hour_of_day)
  }, [data, timezoneOffset])

  const handleTimezoneChange = useCallback(async (newTimezone: string) => {
    setSelectedTimezone(newTimezone)

    setSavingTimezone(true)
    try {
      const supabase = dbClient()
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user) {
        await supabase
          .from(CURRENT_USER_PLAYER_MAPPING)
          .update({ timezone: newTimezone })
          .eq('user_id', userData.user.id)
          .eq('is_current', true)
      }
    } catch (err) {
      console.error('Failed to save timezone preference:', err)
    } finally {
      setSavingTimezone(false)
    }
  }, [])

  useEffect(() => {
    if (!isExpanded || raritiesInitialized) return

    const fetchRarities = async () => {
      try {
        const supabase = dbClient()
        const { data: result, error: rpcError } = await supabase.rpc(
          'get_guild_rarities',
          {
            p_guild_code: guildCode,
            p_season: season ?? undefined
          }
        )

        if (rpcError) throw rpcError

        const rarities = (result || []) as RarityData[]
        const sortedByDifficulty = [...rarities].sort((a, b) => {
          const aIdx = RARITY_ORDER.indexOf(a.rarity)
          const bIdx = RARITY_ORDER.indexOf(b.rarity)
          if (aIdx === -1 && bIdx === -1) return 0
          if (aIdx === -1) return 1
          if (bIdx === -1) return -1
          return aIdx - bIdx
        })
        setAvailableRarities(sortedByDifficulty)

        const top2 = rarities.slice(0, 2).map((r) => r.rarity)
        setSelectedRarities(top2)
        setRaritiesInitialized(true)
      } catch (err) {
        console.error('Failed to fetch rarities:', err)
        setRaritiesInitialized(true)
      }
    }

    fetchRarities()
  }, [isExpanded, guildCode, season, raritiesInitialized])

  useEffect(() => {
    if (!isExpanded) return

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        const supabase = dbClient()
        const { data: result, error: rpcError } = await supabase.rpc(
          'get_hourly_activity',
          {
            p_guild_code: guildCode,
            p_season: season ?? undefined,
            p_player_names:
              selectedPlayers.length > 0 ? selectedPlayers : undefined,
            p_roles: selectedRoles.length > 0 ? selectedRoles : undefined,
            p_boss_name: selectedBoss || undefined,
            p_meta_team: selectedMetaTeam || undefined,
            p_rarities:
              selectedRarities.length > 0 ? selectedRarities : undefined
          }
        )

        if (rpcError) throw rpcError

        const hourlyData = (result || []) as HourlyData[]
        const filledData = HOURS.map((hour) => {
          const found = hourlyData.find((d) => d.hour_of_day === hour)
          return found || { hour_of_day: hour, battle_count: 0, percentage: 0 }
        })

        setData(filledData)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load activity data'
        )
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [
    isExpanded,
    guildCode,
    season,
    selectedPlayers,
    selectedRoles,
    selectedMetaTeam,
    selectedBoss,
    selectedRarities
  ])

  const maxPercentage = useMemo(
    () => Math.max(...adjustedData.map((d) => d.percentage), 1),
    [adjustedData]
  )

  const getBarColor = (percentage: number) => {
    const intensity = percentage / maxPercentage
    if (intensity >= 0.5) return '#F59E0B'
    return '#6B7280'
  }

  const toggleRarity = (rarity: string) => {
    setSelectedRarities((prev) =>
      prev.includes(rarity)
        ? prev.filter((r) => r !== rarity)
        : [...prev, rarity]
    )
  }

  const formatHour = (hour: number) => {
    const h = Math.floor(hour)
    if (h === 0) return '12am'
    if (h === 12) return '12pm'
    return h < 12 ? `${h}am` : `${h - 12}pm`
  }

  return (
    <div className="card-wh40k overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-[color-mix(in_srgb,var(--bg-tertiary)_50%,transparent)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-[var(--accent-primary)]" />
          <span className="font-semibold text-[var(--text-primary)]">
            Player Activity by Hour
          </span>
          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
            {timezoneLabel}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-[var(--text-secondary)]" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[var(--text-secondary)]" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 pt-0 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex flex-wrap gap-3 items-center border-t border-[var(--card-border)] pt-4">
            <Filter className="w-4 h-4 text-[var(--text-tertiary)]" />

            <select
              value={selectedPlayers.length === 1 ? selectedPlayers[0] : ''}
              onChange={(e) =>
                setSelectedPlayers(e.target.value ? [e.target.value] : [])
              }
              className="bg-[var(--bg-tertiary)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] min-w-[140px]"
            >
              <option value="">All Players</option>
              {members.map((m) => (
                <option key={m.display_name} value={m.display_name}>
                  {m.display_name}
                </option>
              ))}
            </select>

            <select
              value={selectedRoles.length === 1 ? selectedRoles[0] : ''}
              onChange={(e) =>
                setSelectedRoles(e.target.value ? [e.target.value] : [])
              }
              className="bg-[var(--bg-tertiary)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] min-w-[120px]"
            >
              <option value="">All Roles</option>
              {uniqueRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>

            <select
              value={selectedMetaTeam}
              onChange={(e) => setSelectedMetaTeam(e.target.value)}
              className="bg-[var(--bg-tertiary)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] min-w-[140px]"
            >
              <option value="">All Teams</option>
              {metaTeams.map((team) => (
                <option key={team.team_name} value={team.team_name}>
                  {team.display_name}
                </option>
              ))}
            </select>

            <select
              value={selectedBoss}
              onChange={(e) => setSelectedBoss(e.target.value)}
              className="bg-[var(--bg-tertiary)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] min-w-[140px]"
            >
              <option value="">All Bosses</option>
              {availableBosses.map((boss) => (
                <option key={boss.boss_name} value={boss.boss_name}>
                  {boss.display_name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[var(--text-tertiary)]" />
              <select
                value={selectedTimezone}
                onChange={(e) => handleTimezoneChange(e.target.value)}
                disabled={savingTimezone}
                className="bg-[var(--bg-tertiary)] border border-[var(--card-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] min-w-[180px] disabled:opacity-50"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              {savingTimezone && (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-primary)]" />
              )}
            </div>

            {availableRarities.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-[var(--text-tertiary)]">
                  Rarity:
                </span>
                {availableRarities.map(({ rarity }) => (
                  <button
                    key={rarity}
                    onClick={() => toggleRarity(rarity)}
                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                      selectedRarities.includes(rarity)
                        ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-white'
                        : 'bg-[var(--bg-tertiary)] border-[var(--card-border)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)]'
                    }`}
                  >
                    {rarity}
                  </button>
                ))}
              </div>
            )}

            {(selectedPlayers.length > 0 ||
              selectedRoles.length > 0 ||
              selectedMetaTeam ||
              selectedBoss ||
              selectedRarities.length !==
                availableRarities.slice(0, 2).length) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedPlayers([])
                  setSelectedRoles([])
                  setSelectedMetaTeam('')
                  setSelectedBoss('')
                  const top2 = availableRarities
                    .slice(0, 2)
                    .map((r) => r.rarity)
                  setSelectedRarities(top2)
                }}
                className="text-xs"
              >
                Clear filters
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-red-400 text-sm">
              {error}
            </div>
          ) : adjustedData.every((d) => d.battle_count === 0) ? (
            <div className="flex items-center justify-center h-48 text-[var(--text-tertiary)] text-sm">
              No battle data found for the selected filters
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={adjustedData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--card-border)"
                  />
                  <XAxis
                    dataKey="hour_of_day"
                    tickFormatter={formatHour}
                    tick={DEFAULT_AXIS_STYLES.tick}
                    axisLine={{ stroke: 'var(--card-border)' }}
                    interval={2}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    tick={DEFAULT_AXIS_STYLES.tick}
                    axisLine={{ stroke: 'var(--card-border)' }}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    wrapperStyle={{ opacity: 1 }}
                    formatter={(value: number | undefined, name?: string) => {
                      if (value == null) return ['—', name ?? '']
                      if (name === 'percentage')
                        return [`${value}%`, 'Activity']
                      return [value, name ?? '']
                    }}
                    labelFormatter={(hour) =>
                      `${formatHour(hour as number)} ${timezoneLabel}`
                    }
                  />
                  <Bar dataKey="percentage" radius={[4, 4, 0, 0]}>
                    {adjustedData.map((entry) => (
                      <Cell
                        key={`cell-hour-${entry.hour_of_day}`}
                        fill={getBarColor(entry.percentage)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: '#F59E0B' }}
                />
                <span className="text-[var(--text-secondary)]">
                  High Activity (&ge;50%)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: '#6B7280' }}
                />
                <span className="text-[var(--text-secondary)]">
                  Low Activity (&lt;50%)
                </span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] text-center">
              Shows when guild members use battle tokens. Times displayed in{' '}
              {TIMEZONE_OPTIONS.find((tz) => tz.value === selectedTimezone)
                ?.label || 'UTC'}
              .
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
