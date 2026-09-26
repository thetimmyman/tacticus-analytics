'use client'

import Link from 'next/link'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  EmptyState
} from '@tacticus/ui-kit'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'
import {
  Swords,
  Users,
  MapPin,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Database
} from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { zoneDisplayName } from '@/app/lib/war/war-naming'
import {
  isValidWarExplorerTab,
  useGuildWarExplorerData,
  WAR_EXPLORER_PAGE_SIZE
} from './useGuildWarExplorerData'

interface WarMatch {
  war_id: string
  guild_code: string
  opponent_guild_code: string | null
  opponent_guild_name: string
  war_status: string
  war_result: string | null
  guild_score: number | null
  opponent_score: number | null
  war_start_date: string | null
  war_end_date: string | null
  war_season: number | null
}

const formatWarGuildLabel = (
  guildCode: string | null | undefined,
  guildName?: string | null
) =>
  formatGuildDisplayLabel(
    { display_name: guildName, guild_code: guildCode },
    guildCode
  )

interface PlayerAttempt {
  id: string
  war_id: string
  guild_code: string
  is_guild_member?: boolean | null
  attacker_team_index?: number | null
  attacker_guild_name?: string | null
  player_id: string
  player_name: string
  attempt_number: number
  attempt_status: string
  attempt_result: string | null
  damage_dealt: number | null
  score_earned: number | null
  attempt_start_time: string | null
  zone_id: string
}

// Names derive from `zone_type`; `zone_name` is a legacy per-sync convention.
interface ZoneAssignment {
  id: string
  war_id: string
  guild_code: string
  zone_number: number
  zone_type: string
  zone_status: string
  assigned_players: string[] | null
  raw_loki_data: unknown | null
}

interface GuildWarExplorerClientProps {
  releaseStage?: string | null
}

function ErrorState({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="h-12 w-12 text-red-400/80 mb-4" />
      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
        Failed to load data
      </h3>
      <p className="text-sm text-[var(--text-secondary)] max-w-md mb-4">
        {message}
      </p>
      <Button onClick={onRetry} variant="outline" className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <RefreshCw className="h-8 w-8 text-[var(--text-secondary)] animate-spin mb-4" />
      <p className="text-sm text-[var(--text-secondary)]">Loading data...</p>
    </div>
  )
}

export default function GuildWarExplorerClient({
  releaseStage
}: GuildWarExplorerClientProps) {
  const hasMounted = useHasMounted()
  // Hydration-safe via hasMounted.
  const fmtNumber = (n: number) => (hasMounted ? n.toLocaleString() : String(n))
  const {
    activeTab,
    setActiveTab,
    searchTerm,
    setSearchTerm,
    debouncedSearch,
    matchesState,
    attemptsState,
    zonesState,
    setMatchesPage,
    setAttemptsPage,
    setZonesPage,
    fetchMatches,
    fetchAttempts,
    fetchZones
  } = useGuildWarExplorerData<WarMatch, PlayerAttempt, ZoneAssignment>()

  const handleTabChange = (value: string) => {
    if (isValidWarExplorerTab(value)) {
      setActiveTab(value)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    if (!hasMounted) return '-'
    // eslint-disable-next-line no-restricted-syntax -- guarded by hasMounted above
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getResultBadge = (result: string | null) => {
    if (!result) {
      return (
        <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]">
          In Progress
        </Badge>
      )
    }
    switch (result.toLowerCase()) {
      case 'win':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            Win
          </Badge>
        )
      case 'loss':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Loss
          </Badge>
        )
      case 'draw':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            Draw
          </Badge>
        )
      default:
        return (
          <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]">
            {result}
          </Badge>
        )
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            Active
          </Badge>
        )
      case 'completed':
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            Completed
          </Badge>
        )
      case 'failed':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Failed
          </Badge>
        )
      default:
        return (
          <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]">
            {status}
          </Badge>
        )
    }
  }

  const computeZoneTotalScore = (zone: ZoneAssignment): number => {
    const raw = zone.raw_loki_data
    if (!raw || typeof raw !== 'object') return 0
    const attempts = (raw as { attempts?: unknown }).attempts
    if (!Array.isArray(attempts)) return 0
    return attempts.reduce((sum, attempt) => {
      const score = (attempt as { scoreEarned?: unknown })?.scoreEarned
      return sum + (typeof score === 'number' ? score : 0)
    }, 0)
  }

  // Rows arrive sorted/paginated; DataTable's <td> forces text-secondary, so primary cells use a span.
  const matchesColumns: DataTableColumn<WarMatch>[] = [
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      render: (match) => (
        <span className="text-[var(--text-primary)]">
          {formatWarGuildLabel(match.guild_code)}
        </span>
      )
    },
    {
      key: 'opponent',
      header: 'Opponent',
      sortable: false,
      render: (match) => (
        <span className="text-[var(--text-primary)]">
          {match.opponent_guild_code
            ? formatWarGuildLabel(
                match.opponent_guild_code,
                match.opponent_guild_name
              )
            : '-'}
        </span>
      )
    },
    {
      key: 'score',
      header: 'Score',
      sortable: false,
      align: 'center',
      render: (match) => (
        <>
          <span className="font-medium text-[var(--text-primary)]">
            {match.guild_score ?? '-'}
          </span>
          <span className="text-[var(--text-tertiary)] mx-1">-</span>
          <span className="font-medium text-[var(--text-primary)]">
            {match.opponent_score ?? '-'}
          </span>
        </>
      )
    },
    {
      key: 'result',
      header: 'Result',
      sortable: false,
      align: 'center',
      render: (match) => getResultBadge(match.war_result)
    },
    {
      key: 'status',
      header: 'Status',
      sortable: false,
      align: 'center',
      className: 'hidden md:table-cell',
      render: (match) => getStatusBadge(match.war_status)
    },
    {
      key: 'date',
      header: 'Date',
      sortable: false,
      className: 'hidden sm:table-cell',
      render: (match) => formatDate(match.war_start_date)
    },
    {
      key: 'details',
      header: 'Details',
      sortable: false,
      align: 'center',
      render: () => (
        <Link
          href="/wars"
          className="inline-flex items-center gap-1 text-[var(--accent)] hover:text-[var(--text-primary)] text-xs"
          title="View in War Tracking"
        >
          <ExternalLink className="h-3 w-3" />
          View
        </Link>
      )
    }
  ]

  const attemptsColumns: DataTableColumn<PlayerAttempt>[] = [
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      className: 'hidden md:table-cell',
      render: (attempt) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[var(--text-primary)]">
            {formatWarGuildLabel(
              attempt.guild_code,
              attempt.attacker_guild_name
            )}
          </span>
          {attempt.is_guild_member === false && (
            <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] text-xs">
              Opponent
            </Badge>
          )}
        </div>
      )
    },
    {
      key: 'player',
      header: 'Player',
      sortable: false,
      render: (attempt) => (
        <>
          <div className="text-[var(--text-primary)]">
            {attempt.player_name}
          </div>
          <div className="md:hidden text-[10px] text-[var(--text-secondary)]">
            {formatWarGuildLabel(
              attempt.guild_code,
              attempt.attacker_guild_name
            )}
            {attempt.is_guild_member === false && (
              <Badge className="ml-1 bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] text-[10px]">
                Opponent
              </Badge>
            )}
          </div>
        </>
      )
    },
    {
      key: 'attemptNumber',
      header: 'Attempt #',
      sortable: false,
      align: 'center',
      render: (attempt) => attempt.attempt_number
    },
    {
      key: 'result',
      header: 'Result',
      sortable: false,
      align: 'center',
      render: (attempt) =>
        attempt.attempt_result === 'win' ? (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            Win
          </Badge>
        ) : attempt.attempt_result === 'loss' ? (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Loss
          </Badge>
        ) : (
          <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]">
            {attempt.attempt_status}
          </Badge>
        )
    },
    {
      key: 'score',
      header: 'Score',
      sortable: false,
      align: 'right',
      render: (attempt) => (
        <span className="font-medium text-[var(--text-primary)]">
          {formatNumber(attempt.score_earned ?? 0)}
        </span>
      )
    },
    {
      key: 'time',
      header: 'Time',
      sortable: false,
      className: 'hidden sm:table-cell',
      render: (attempt) => formatDate(attempt.attempt_start_time)
    }
  ]

  const zonesColumns: DataTableColumn<ZoneAssignment>[] = [
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      className: 'hidden md:table-cell',
      render: (zone) => (
        <span className="font-mono text-[var(--text-primary)]">
          {formatWarGuildLabel(zone.guild_code)}
        </span>
      )
    },
    {
      key: 'zoneNumber',
      header: 'Zone #',
      sortable: false,
      align: 'center',
      render: (zone) => (
        <span className="text-[var(--text-primary)]">{zone.zone_number}</span>
      )
    },
    {
      key: 'type',
      header: 'Zone',
      sortable: false,
      render: (zone) => {
        const assignedPlayers = zone.assigned_players ?? []
        return (
          <>
            <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]">
              {zoneDisplayName(zone.zone_type)}
            </Badge>
            <div className="mt-1 text-[10px] text-[var(--text-secondary)] lg:hidden">
              {assignedPlayers.length > 0
                ? `${assignedPlayers.length} assigned`
                : 'No assignments'}
            </div>
          </>
        )
      }
    },
    {
      key: 'status',
      header: 'Status',
      sortable: false,
      align: 'center',
      render: (zone) => (
        <Badge
          className={
            zone.zone_status === 'completed'
              ? 'bg-green-500/20 text-green-400 border-green-500/30'
              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)]'
          }
        >
          {zone.zone_status}
        </Badge>
      )
    },
    {
      key: 'assignedPlayers',
      header: 'Assigned Players',
      sortable: false,
      className: 'hidden lg:table-cell',
      render: (zone) => {
        const assignedPlayers = zone.assigned_players ?? []
        if (assignedPlayers.length === 0) {
          return <span className="text-[var(--text-secondary)]">-</span>
        }
        return (
          <div className="flex flex-wrap gap-1">
            {assignedPlayers.slice(0, 3).map((player) => (
              <Badge
                key={player}
                className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] text-xs"
              >
                {player}
              </Badge>
            ))}
            {assignedPlayers.length > 3 && (
              <Badge className="bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] text-xs">
                +{assignedPlayers.length - 3}
              </Badge>
            )}
          </div>
        )
      }
    },
    {
      key: 'totalScore',
      header: 'Total Score',
      sortable: false,
      align: 'right',
      render: (zone) => (
        <span className="font-medium text-[var(--text-primary)]">
          {formatNumber(computeZoneTotalScore(zone))}
        </span>
      )
    }
  ]

  const Pagination = ({
    page,
    setPage,
    total,
    loading
  }: {
    page: number
    setPage: (p: number) => void
    total: number
    loading: boolean
  }) => {
    const totalPages = Math.ceil(total / WAR_EXPLORER_PAGE_SIZE)
    if (total === 0) return null

    return (
      <div className="flex items-center justify-between mt-4 px-2">
        <span className="text-sm text-[var(--text-secondary)]">
          {fmtNumber(total)} {total === 1 ? 'result' : 'results'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0 || loading}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm text-[var(--text-secondary)]">
            Page {page + 1} of {totalPages || 1}
          </span>
          <Button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1 || loading}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Next page"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>
    )
  }

  const renderMatchesContent = () => {
    if (matchesState.loading) return <LoadingState />
    if (matchesState.error)
      return <ErrorState message={matchesState.error} onRetry={fetchMatches} />
    if (matchesState.data.length === 0) {
      return debouncedSearch ? (
        <EmptyState icon={Search} title="No matches found">
          No war matches found for &quot;{debouncedSearch}&quot;. Try a
          different search term or clear the filter.
        </EmptyState>
      ) : (
        <EmptyState icon={Database} title="No war data yet">
          War data will appear here once guilds start syncing their Guild War
          information. Check the War Tracking page to configure sync.
        </EmptyState>
      )
    }

    return (
      <>
        <DataTable
          tableClassName="text-xs sm:text-sm"
          rows={matchesState.data}
          columns={matchesColumns}
          rowKey={(match) => `${match.war_id}-${match.guild_code}`}
          empty={<></>}
        />
        <Pagination
          page={matchesState.page}
          setPage={setMatchesPage}
          total={matchesState.total}
          loading={matchesState.loading}
        />
      </>
    )
  }

  const renderAttemptsContent = () => {
    if (attemptsState.loading) return <LoadingState />
    if (attemptsState.error)
      return (
        <ErrorState message={attemptsState.error} onRetry={fetchAttempts} />
      )
    if (attemptsState.data.length === 0) {
      return debouncedSearch ? (
        <EmptyState icon={Search} title="No player activity found">
          No player attempts found for &quot;{debouncedSearch}&quot;. Try
          searching by player name or guild code.
        </EmptyState>
      ) : (
        <EmptyState icon={Users} title="No player activity yet">
          Player war attempts will appear here once guilds sync their Guild War
          data. Enable sync in War Tracking to start collecting data.
        </EmptyState>
      )
    }

    return (
      <>
        <DataTable
          tableClassName="text-xs sm:text-sm"
          rows={attemptsState.data}
          columns={attemptsColumns}
          rowKey={(attempt) => attempt.id}
          empty={<></>}
        />
        <Pagination
          page={attemptsState.page}
          setPage={setAttemptsPage}
          total={attemptsState.total}
          loading={attemptsState.loading}
        />
      </>
    )
  }

  const renderZonesContent = () => {
    if (zonesState.loading) return <LoadingState />
    if (zonesState.error)
      return <ErrorState message={zonesState.error} onRetry={fetchZones} />
    if (zonesState.data.length === 0) {
      return debouncedSearch ? (
        <EmptyState icon={Search} title="No zones found">
          No zone assignments found for &quot;{debouncedSearch}&quot;. Try
          searching by guild code or zone name.
        </EmptyState>
      ) : (
        <EmptyState icon={MapPin} title="No zone data yet">
          Zone assignment data will appear here once guilds sync their Guild War
          information. Configure sync in the War Tracking page.
        </EmptyState>
      )
    }

    return (
      <>
        <DataTable
          tableClassName="text-xs sm:text-sm"
          rows={zonesState.data}
          columns={zonesColumns}
          rowKey={(zone) => zone.id}
          empty={<></>}
        />
        <Pagination
          page={zonesState.page}
          setPage={setZonesPage}
          total={zonesState.total}
          loading={zonesState.loading}
        />
      </>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 px-3 md:px-0">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">
              Guild War Explorer
            </h1>
            {releaseStage && releaseStage !== 'public' && (
              <Badge className="border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-[10px] uppercase tracking-wide">
                {releaseStage}
              </Badge>
            )}
          </div>
          <p className="text-[var(--text-secondary)] mt-2">
            Browse war data across all synced guilds
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/wars"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
          >
            <ExternalLink className="h-4 w-4" />
            War Tracking
          </Link>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
        <Input
          placeholder="Search by guild code, player name, or opponent..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
        {searchTerm && (
          <Button
            type="button"
            onClick={() => setSearchTerm('')}
            variant="ghost"
            size="sm"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-label="Clear search"
          >
            <span className="text-lg leading-none">×</span>
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <PageTabsSubnav
          ariaLabel="War Explorer sections"
          value={activeTab}
          onValueChange={handleTabChange}
          tabs={[
            {
              value: 'matches',
              label: 'War Results',
              icon: <Swords className="h-3.5 w-3.5" />
            },
            {
              value: 'activity',
              label: 'Player Activity',
              icon: <Users className="h-3.5 w-3.5" />
            },
            {
              value: 'zones',
              label: 'Zone Assignments',
              icon: <MapPin className="h-3.5 w-3.5" />
            }
          ]}
        />

        {activeTab === 'matches' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg text-[var(--text-primary)]">
                <span>War Results</span>
                {matchesState.total > 0 && (
                  <span className="text-xs font-normal text-[var(--text-secondary)]">
                    {fmtNumber(matchesState.total)} total
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">{renderMatchesContent()}</CardContent>
          </Card>
        )}

        {activeTab === 'activity' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg text-[var(--text-primary)]">
                <span>Player Activity</span>
                {attemptsState.total > 0 && (
                  <span className="text-xs font-normal text-[var(--text-secondary)]">
                    {fmtNumber(attemptsState.total)} total
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {renderAttemptsContent()}
            </CardContent>
          </Card>
        )}

        {activeTab === 'zones' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-lg text-[var(--text-primary)]">
                <span>Zone Assignments</span>
                {zonesState.total > 0 && (
                  <span className="text-xs font-normal text-[var(--text-secondary)]">
                    {fmtNumber(zonesState.total)} total
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">{renderZonesContent()}</CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
