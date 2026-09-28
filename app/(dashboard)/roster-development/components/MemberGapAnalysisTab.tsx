'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { ExternalLink, GraduationCap, RefreshCw } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import {
  DEFAULT_TIERS,
  FALLBACK_ORDER,
  SOURCE_LABELS,
  STATUS_CONFIG,
  STATUS_SORT_ORDER,
  ScoreDisplay,
  SourceBadge,
  StatusBadge,
  formatPerformancePercent,
  getPerformanceColor,
  type MemberGapColumnKey,
  type MemberGapData,
  type MemberGapsResponse,
  type MemberStatus,
  type ScoringConfig,
  type ScoringConfigResponse,
  type SortDirection,
  type SortField,
  type StatusFilter
} from './member-gap-analysis-shared'
import { MemberGapAnalysisScoringSettings } from './MemberGapAnalysisScoringSettings'

export function MemberGapAnalysisTab() {
  const [data, setData] = useState<MemberGapsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [coachMode, setCoachMode] = useState(false)
  const [sortField, setSortField] = useState<SortField>('score')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [refreshKey, setRefreshKey] = useState(0)

  const [configState, setConfigState] = useState<ScoringConfigResponse | null>(
    null
  )
  const [configDraft, setConfigDraft] = useState<ScoringConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configMessage, setConfigMessage] = useState<string | null>(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const loadScoringConfig = useCallback(async () => {
    try {
      setConfigError(null)
      setConfigLoading(true)
      const response = await fetch('/api/roster-development/scoring-config')
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to load scoring settings')
      }
      setConfigState(result)
      setConfigDraft(result.config)
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : 'Failed to load scoring settings'
      )
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    loadScoringConfig()
  }, [loadScoringConfig])

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        setError(null)
        setLoading(true)
        const params = new URLSearchParams()
        if (coachMode) params.set('coach_mode', 'true')
        const response = await fetch(
          `/api/roster-development/member-gaps?${params}`
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result?.error || 'Failed to load member gaps')
        }
        if (!cancelled) {
          setData(result)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load member gaps'
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [coachMode, refreshKey])

  const handleSort = useCallback(
    (field: SortField) => {
      setSortDirection((prev) => {
        if (sortField === field) {
          return prev === 'asc' ? 'desc' : 'asc'
        }
        return 'asc'
      })
      setSortField(field)
    },
    [sortField]
  )

  const filteredMembers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!data?.members) return []
    return data.members.filter((member) => {
      if (statusFilter !== 'all' && member.status !== statusFilter) return false
      if (!term) return true
      return (member.display_name || '').toLowerCase().includes(term)
    })
  }, [data?.members, searchTerm, statusFilter])

  const summary = useMemo(() => {
    if (!data?.members) return null
    const total = data.members.length
    const optimal = data.members.filter((m) => m.status === 'optimal').length
    const strong = data.members.filter((m) => m.status === 'strong').length
    const suitable = data.members.filter((m) => m.status === 'suitable').length
    const weak = data.members.filter((m) => m.status === 'weak').length
    const noRoster = data.members.filter((m) => m.status === 'no-roster').length
    const noRequirements = data.members.filter(
      (m) => m.status === 'no-requirements'
    ).length
    return { total, optimal, strong, suitable, weak, noRoster, noRequirements }
  }, [data?.members])

  const fallbackChain = useMemo(() => {
    const primary = configDraft?.primary_source ?? 'playbook'
    return [primary, ...FALLBACK_ORDER.filter((source) => source !== primary)]
  }, [configDraft?.primary_source])

  const currentTiers = useMemo(() => {
    if (!configDraft) return DEFAULT_TIERS
    return {
      optimal: configDraft.tier_optimal_pct ?? DEFAULT_TIERS.optimal,
      strong: configDraft.tier_strong_pct ?? DEFAULT_TIERS.strong,
      suitable: configDraft.tier_suitable_pct ?? DEFAULT_TIERS.suitable
    }
  }, [configDraft])

  const tierInvalid = useMemo(() => {
    if (!configDraft) return false
    return (
      configDraft.tier_optimal_pct < configDraft.tier_strong_pct ||
      configDraft.tier_strong_pct < configDraft.tier_suitable_pct
    )
  }, [configDraft])

  const saveConfig = useCallback(async () => {
    if (!configDraft) return
    try {
      setConfigMessage(null)
      setConfigError(null)
      setConfigSaving(true)
      const response = await fetch('/api/roster-development/scoring-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_source: configDraft.primary_source,
          strength_target_rarity_set: configDraft.strength_target_rarity_set,
          tier_optimal_pct: configDraft.tier_optimal_pct,
          tier_strong_pct: configDraft.tier_strong_pct,
          tier_suitable_pct: configDraft.tier_suitable_pct
        })
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to save scoring settings')
      }
      setConfigMessage('Scoring settings updated.')
      setConfigDraft(result.config ?? configDraft)
      await loadScoringConfig()
      setRefreshKey((prev) => prev + 1)
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : 'Failed to save scoring settings'
      )
    } finally {
      setConfigSaving(false)
    }
  }, [configDraft, loadScoringConfig])

  const renderSummary = () => (
    <Card className="bg-(--card-bg) border-(--card-border)">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-lg">Member Analysis</CardTitle>
          <p className="text-xs text-secondary-wh40k">
            Identify development opportunities and track roster readiness.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshKey((prev) => prev + 1)
            loadScoringConfig()
          }}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading && (
          <div className="py-6">
            <LoadingSpinner message="Loading member analysis..." />
          </div>
        )}

        {!loading && summary && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
              <div className="text-xs text-secondary-wh40k">Total members</div>
              <div className="text-2xl font-semibold text-primary-wh40k">
                {summary.total}
              </div>
            </div>
            {(['optimal', 'strong', 'suitable', 'weak'] as MemberStatus[]).map(
              (status) => (
                <div
                  key={status}
                  className={`rounded-lg border border-(--card-border) p-3 ${STATUS_CONFIG[status].className}`}
                >
                  <div className="text-xs">{STATUS_CONFIG[status].label}</div>
                  <div className="text-2xl font-semibold text-primary-wh40k">
                    {summary[status as keyof typeof summary] ?? 0}
                  </div>
                </div>
              )
            )}
            <div className="rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
              <div className="text-xs text-secondary-wh40k">No roster</div>
              <div className="text-2xl font-semibold text-primary-wh40k">
                {summary.noRoster}
              </div>
            </div>
            <div className="rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
              <div className="text-xs text-secondary-wh40k">
                No requirements
              </div>
              <div className="text-2xl font-semibold text-primary-wh40k">
                {summary.noRequirements}
              </div>
            </div>
          </div>
        )}

        {!loading && data && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] p-3">
              <div className="text-xs text-secondary-wh40k mb-2">
                Active targets
              </div>
              <div className="text-sm text-primary-wh40k">
                {data.targets_label} ({data.targets_analyzed.length})
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.targets_analyzed.slice(0, 8).map((target) => (
                  <span
                    key={target.target_id}
                    className="rounded-full border border-(--card-border) px-2 py-0.5 text-[10px] text-secondary-wh40k"
                  >
                    {target.target_name}
                  </span>
                ))}
                {data.targets_analyzed.length > 8 && (
                  <span className="rounded-full border border-(--card-border) px-2 py-0.5 text-[10px] text-secondary-wh40k">
                    +{data.targets_analyzed.length - 8} more
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] p-3">
              <div className="text-xs text-secondary-wh40k mb-2">
                Active source
              </div>
              <div className="text-sm text-primary-wh40k">
                {data.active_source
                  ? SOURCE_LABELS[data.active_source].title
                  : 'No targets available'}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {fallbackChain.map((source) => (
                  <span
                    key={source}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${SOURCE_LABELS[source].badgeClass} ${data.active_source === source ? '' : 'opacity-60'}`}
                  >
                    {SOURCE_LABELS[source].short}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )

  const renderTable = () => {
    if (loading) return null
    if (!data) {
      return (
        <div className="py-6 text-center text-sm text-secondary-wh40k">
          No member analysis data available.
        </div>
      )
    }

    if (filteredMembers.length === 0) {
      return (
        <div className="py-6 text-center text-sm text-secondary-wh40k">
          No members match the current filters.
        </div>
      )
    }

    // DataTable owns the sort; nulls map to +Infinity (last asc, first desc).
    const columns: DataTableColumn<MemberGapData, MemberGapColumnKey>[] = [
      {
        key: 'name',
        header: 'Member',
        sortValue: (member) => member.display_name || '',
        render: (member) => (
          <div className="flex flex-col gap-1">
            <div className="font-semibold text-primary-wh40k">
              {member.display_name || 'Unknown'}
            </div>
            {member.display_name && (
              <Link
                href={`/player-stats?player=${encodeURIComponent(member.display_name)}&guild=${encodeURIComponent(data.guild_code)}`}
                className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
              >
                Player Stats
                <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </div>
        )
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (member) => STATUS_SORT_ORDER[member.status] ?? 6,
        render: (member) => <StatusBadge status={member.status} />
      },
      {
        key: 'score',
        header: 'Score',
        sortValue: (member) => member.overall_score ?? Number.POSITIVE_INFINITY,
        render: (member) => (
          <ScoreDisplay score={member.overall_score} status={member.status} />
        )
      },
      {
        key: 'roster_count',
        header: 'Roster',
        sortValue: (member) => member.roster_count,
        render: (member) => (
          <span className="text-secondary-wh40k">{member.roster_count}</span>
        )
      },
      {
        key: 'performance',
        header: 'Vs guild avg',
        sortValue: (member) =>
          member.performance_vs_guild_avg ?? Number.POSITIVE_INFINITY,
        render: (member) =>
          member.performance_vs_guild_avg === null ? (
            <span className="text-secondary-wh40k">-</span>
          ) : (
            <span
              className={`font-semibold ${getPerformanceColor(member.performance_vs_guild_avg)}`}
            >
              {formatPerformancePercent(member.performance_vs_guild_avg)}
            </span>
          )
      },
      {
        key: 'targets',
        header: 'Targets',
        sortable: false,
        render: (member) => {
          const targetScores = [...member.target_scores].sort(
            (a, b) => a.score - b.score
          )
          return targetScores.length === 0 ? (
            <span className="text-xs text-secondary-wh40k">No targets</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {targetScores.map((target) => (
                <span
                  key={`${member.player_id}-${target.target_id}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${
                    STATUS_CONFIG[target.status].badgeClass
                  } ${target.coach_highlight ? 'ring-1 ring-amber-400/40' : ''}`}
                >
                  <span className="font-semibold">{target.target_name}</span>
                  <span>{Math.round(target.score)}%</span>
                  <SourceBadge source={target.source} />
                  {target.coach_highlight && (
                    <GraduationCap className="w-3 h-3" />
                  )}
                </span>
              ))}
            </div>
          )
        }
      }
    ]

    return (
      <DataTable
        rows={filteredMembers}
        columns={columns}
        rowKey={(member) => member.player_id}
        sort={{ key: sortField, direction: sortDirection }}
        onSortChange={(next) => {
          // DataTable never calls onSortChange for the unsortable Targets column, so the cast is safe.
          handleSort(next.key as SortField)
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      {renderSummary()}
      <MemberGapAnalysisScoringSettings
        data={data}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        configLoading={configLoading}
        configError={configError}
        configDraft={configDraft}
        setConfigDraft={setConfigDraft}
        configState={configState}
        currentTiers={currentTiers}
        fallbackChain={fallbackChain}
        tierInvalid={tierInvalid}
        configMessage={configMessage}
        configSaving={configSaving}
        saveConfig={saveConfig}
      />
      <Card className="bg-(--card-bg) border-(--card-border)">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Member Breakdown</CardTitle>
            <div className="text-xs text-secondary-wh40k">
              Showing {filteredMembers.length} of {data?.members.length ?? 0}{' '}
              members
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_200px_160px] items-end">
            <label className="space-y-1 text-xs text-secondary-wh40k">
              Search
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-(--card-border) bg-(--bg-secondary) px-3 py-2 text-sm text-primary-wh40k"
                placeholder="Search member name"
              />
            </label>
            <label className="space-y-1 text-xs text-secondary-wh40k">
              Status
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                className="w-full rounded-md border border-(--card-border) bg-(--bg-secondary) px-3 py-2 text-sm text-primary-wh40k"
              >
                <option value="all">All statuses</option>
                {Object.entries(STATUS_CONFIG).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-secondary-wh40k">
              <input
                type="checkbox"
                checked={coachMode}
                onChange={(event) => setCoachMode(event.target.checked)}
                className="h-4 w-4"
              />
              Coach highlight
            </label>
          </div>
        </CardHeader>
        <CardContent>{renderTable()}</CardContent>
      </Card>
    </div>
  )
}
