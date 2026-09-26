'use client'

import { DEFAULT_RECHARTS_TOOLTIP_PROPS } from '@tacticus/charting/tooltip'
import { DEFAULT_AXIS_STYLES } from '@tacticus/charting/styles'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import {
  Activity,
  Users,
  TrendingUp,
  Filter,
  RefreshCw,
  Loader2,
  BarChart3,
  PieChart,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText
} from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from '@/app/components/RechartsWrapper'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { PlatformSummaryChart } from './PlatformSummaryChart'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { formatUtcDateLabel } from '@/app/lib/season-date/date-format'

interface ActivitySummary {
  totalClaimedUsers: number
  activeCount: number
  inactiveCount: number
  activityRate: number
  daysBack: number
}

interface DailyActivity {
  date: string
  count: number
}

interface GuildActivity {
  guild_code: string
  guild_name: string
  active: number
  total: number
  rate: number
}

interface RoleActivity {
  role: string
  active: number
  total: number
  rate: number
}

interface ClusterActivity {
  cluster: string
  active: number
  total: number
  rate: number
}

interface FilterOptions {
  guilds: {
    guild_code: string
    display_name: string
    cluster_code: string | null
  }[]
  clusters: string[]
  roles: string[]
}

interface PageView {
  path: string
  count: number
  unique_users: number
}

type GuildSortKey = 'guild_name' | 'active' | 'total' | 'rate'
type SortDirection = 'asc' | 'desc'

interface ActivityData {
  summary: ActivitySummary
  dailyActivity: DailyActivity[]
  guildActivity: GuildActivity[]
  roleActivity: RoleActivity[]
  clusterActivity: ClusterActivity[]
  pageViews: PageView[]
  filters: FilterOptions
}

const DAYS_OPTIONS = [7, 14, 30, 60, 90]

const formatDateLabel = formatUtcDateLabel

export function ActivityAnalytics() {
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedGuild, setSelectedGuild] = useState<string>('')
  const [selectedCluster, setSelectedCluster] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<string>('')
  const [daysBack, setDaysBack] = useState<number>(30)
  const [showFilters, setShowFilters] = useState(false)

  const [guildTableSearch, setGuildTableSearch] = useState('')
  const [guildTableSort, setGuildTableSort] = useState<GuildSortKey>('active')
  const [guildTableSortDir, setGuildTableSortDir] =
    useState<SortDirection>('desc')
  const [guildTablePage, setGuildTablePage] = useState(1)
  const GUILDS_PER_PAGE = 10

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (selectedGuild) params.set('guild_code', selectedGuild)
      if (selectedCluster) params.set('cluster_code', selectedCluster)
      if (selectedRole) params.set('role', selectedRole)
      params.set('days_back', daysBack.toString())

      const res = await fetch(`/api/admin/activity-analytics?${params}`)
      if (!res.ok) {
        throw new Error('Failed to fetch activity data')
      }

      const result = await res.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [selectedGuild, selectedCluster, selectedRole, daysBack])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const clearFilters = () => {
    setSelectedGuild('')
    setSelectedCluster('')
    setSelectedRole('')
    setDaysBack(30)
  }

  const hasActiveFilters =
    selectedGuild || selectedCluster || selectedRole || daysBack !== 30

  const guildActivity = useMemo(
    () => data?.guildActivity ?? [],
    [data?.guildActivity]
  )

  const filteredAndSortedGuilds = useMemo(() => {
    let filtered = [...guildActivity]

    if (guildTableSearch) {
      const searchLower = guildTableSearch.toLowerCase()
      filtered = filtered.filter(
        (g) =>
          g.guild_name.toLowerCase().includes(searchLower) ||
          g.guild_code.toLowerCase().includes(searchLower)
      )
    }

    filtered.sort((a, b) => {
      const aVal = a[guildTableSort]
      const bVal = b[guildTableSort]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return guildTableSortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }
      return guildTableSortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

    return filtered
  }, [guildActivity, guildTableSearch, guildTableSort, guildTableSortDir])

  const totalGuildPages = Math.ceil(
    filteredAndSortedGuilds.length / GUILDS_PER_PAGE
  )
  const paginatedGuilds = filteredAndSortedGuilds.slice(
    (guildTablePage - 1) * GUILDS_PER_PAGE,
    guildTablePage * GUILDS_PER_PAGE
  )

  // The list is sorted and paginated already, so DataTable renders the slice; sorting resets to page 1.
  const handleGuildTableSortChange = (next: {
    key: GuildSortKey
    direction: SortDirection
  }) => {
    setGuildTableSort(next.key)
    setGuildTableSortDir(next.direction)
    setGuildTablePage(1)
  }

  const guildActivityColumns: DataTableColumn<GuildActivity, GuildSortKey>[] = [
    {
      key: 'guild_name',
      header: 'Guild',
      sortValue: (g) => g.guild_name,
      render: (g) => (
        <span className="text-[var(--text-primary)]">{g.guild_name}</span>
      )
    },
    {
      key: 'active',
      header: 'Active',
      align: 'right',
      sortValue: (g) => g.active,
      render: (g) => <span className="text-green-400">{g.active}</span>
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (g) => g.total,
      render: (g) => g.total
    },
    {
      key: 'rate',
      header: 'Rate',
      align: 'right',
      sortValue: (g) => g.rate,
      render: (g) => (
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            g.rate >= 70
              ? 'bg-green-500/20 text-green-400'
              : g.rate >= 40
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
          }`}
        >
          {g.rate}%
        </span>
      )
    }
  ]

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-red-400">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)]"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const {
    summary,
    dailyActivity,
    roleActivity,
    clusterActivity,
    pageViews,
    filters
  } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-[var(--accent)]" />
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              User Activity Analytics
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Track app engagement across guilds, roles, and clusters
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${
                showFilters || hasActiveFilters
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--card-border)]'
              }
            `}
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">
                {
                  [
                    selectedGuild,
                    selectedCluster,
                    selectedRole,
                    daysBack !== 30
                  ].filter(Boolean).length
                }
              </span>
            )}
          </button>
          <button
            onClick={() => {
              void fetchData()
            }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--card-border)] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="py-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Guild
                </label>
                <select
                  value={selectedGuild}
                  onChange={(e) => setSelectedGuild(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-sm text-[var(--text-primary)]"
                >
                  <option value="">All Guilds</option>
                  {filters.guilds.map((g) => (
                    <option key={g.guild_code} value={g.guild_code}>
                      {formatGuildDisplayLabel(
                        {
                          display_name: g.display_name,
                          guild_code: g.guild_code
                        },
                        g.guild_code
                      )}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Cluster
                </label>
                <select
                  value={selectedCluster}
                  onChange={(e) => setSelectedCluster(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-sm text-[var(--text-primary)]"
                >
                  <option value="">All Clusters</option>
                  {filters.clusters.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Role
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-sm text-[var(--text-primary)]"
                >
                  <option value="">All Roles</option>
                  {filters.roles.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Time Period
                </label>
                <select
                  value={daysBack}
                  onChange={(e) => setDaysBack(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-sm text-[var(--text-primary)]"
                >
                  {DAYS_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      Last {d} days
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={clearFilters}
                  className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {summary.totalClaimedUsers}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Total Claimed Users
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <TrendingUp className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {summary.activeCount}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Active ({summary.daysBack}d)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <Users className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {summary.inactiveCount}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">Inactive</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <BarChart3 className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {summary.activityRate}%
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Activity Rate
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <PlatformSummaryChart />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Daily Active Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyActivity}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--card-border)"
                  />
                  <XAxis
                    dataKey="date"
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(value) => {
                      const d = new Date(value)
                      return `${d.getMonth() + 1}/${d.getDate()}`
                    }}
                  />
                  <YAxis tick={DEFAULT_AXIS_STYLES.tick} />
                  <Tooltip
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    labelFormatter={(value) => formatDateLabel(value)}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    name="Active Users"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              Activity by Role
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roleActivity} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--card-border)"
                  />
                  <XAxis type="number" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis
                    dataKey="role"
                    type="category"
                    tick={DEFAULT_AXIS_STYLES.tick}
                    tickFormatter={(v) =>
                      v.charAt(0).toUpperCase() + v.slice(1)
                    }
                    width={70}
                  />
                  <Tooltip
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    formatter={(value: number | undefined, name?: string) => [
                      value ?? '—',
                      name === 'active' ? 'Active' : 'Total'
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="active"
                    fill="#22c55e"
                    name="Active"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="total"
                    fill="#3b82f6"
                    name="Total"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Activity by Guild
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={guildActivity.slice(0, 15)}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--card-border)"
                />
                <XAxis
                  dataKey="guild_name"
                  tick={DEFAULT_AXIS_STYLES.tick}
                  angle={-45}
                  interval={0}
                />
                <YAxis tick={DEFAULT_AXIS_STYLES.tick} />
                <Tooltip
                  contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  formatter={(value: number | undefined, name?: string) => [
                    value ?? '—',
                    name === 'active'
                      ? 'Active'
                      : name === 'rate'
                        ? 'Rate %'
                        : 'Total'
                  ]}
                />
                <Legend />
                <Bar
                  dataKey="active"
                  fill="#22c55e"
                  name="Active"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="total"
                  fill="#3b82f6"
                  name="Total"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {clusterActivity.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Activity by Cluster
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clusterActivity}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--card-border)"
                  />
                  <XAxis dataKey="cluster" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis tick={DEFAULT_AXIS_STYLES.tick} />
                  <Tooltip
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                  />
                  <Legend />
                  <Bar
                    dataKey="active"
                    fill="#22c55e"
                    name="Active"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="total"
                    fill="#3b82f6"
                    name="Total"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {pageViews && pageViews.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Most Visited Pages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pageViews.slice(0, 12)} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--card-border)"
                  />
                  <XAxis type="number" tick={DEFAULT_AXIS_STYLES.tick} />
                  <YAxis
                    dataKey="path"
                    type="category"
                    tick={DEFAULT_AXIS_STYLES.tick}
                    width={150}
                    tickFormatter={(v) =>
                      v.length > 25 ? v.slice(0, 25) + '...' : v
                    }
                  />
                  <Tooltip
                    contentStyle={DEFAULT_RECHARTS_TOOLTIP_PROPS.contentStyle}
                    formatter={(value: number | undefined, name?: string) => [
                      value ?? '—',
                      name === 'count' ? 'Page Views' : 'Unique Users'
                    ]}
                  />
                  <Legend />
                  <Bar
                    dataKey="count"
                    fill="#8b5cf6"
                    name="Page Views"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="unique_users"
                    fill="#22c55e"
                    name="Unique Users"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Guild Activity Table</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search guilds..."
                value={guildTableSearch}
                onChange={(e) => {
                  setGuildTableSearch(e.target.value)
                  setGuildTablePage(1)
                }}
                className="pl-9 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-sm text-[var(--text-primary)] w-48"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={paginatedGuilds}
            columns={guildActivityColumns}
            rowKey={(g) => g.guild_code}
            sort={{ key: guildTableSort, direction: guildTableSortDir }}
            onSortChange={handleGuildTableSortChange}
            externallySorted
            empty={
              <div className="py-8 text-center text-[var(--text-secondary)]">
                No guilds found
              </div>
            }
          />

          {totalGuildPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--card-border)]">
              <div className="text-sm text-[var(--text-secondary)]">
                Showing {(guildTablePage - 1) * GUILDS_PER_PAGE + 1}-
                {Math.min(
                  guildTablePage * GUILDS_PER_PAGE,
                  filteredAndSortedGuilds.length
                )}{' '}
                of {filteredAndSortedGuilds.length} guilds
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGuildTablePage((p) => Math.max(1, p - 1))}
                  disabled={guildTablePage === 1}
                  className="p-1.5 rounded hover:bg-[var(--card-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-[var(--text-primary)]">
                  Page {guildTablePage} of {totalGuildPages}
                </span>
                <button
                  onClick={() =>
                    setGuildTablePage((p) => Math.min(totalGuildPages, p + 1))
                  }
                  disabled={guildTablePage === totalGuildPages}
                  className="p-1.5 rounded hover:bg-[var(--card-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
