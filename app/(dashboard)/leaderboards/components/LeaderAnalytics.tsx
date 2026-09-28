'use client'

import { useState, useEffect } from 'react'
import { ClientDate } from '@tacticus/ui-kit'
import { dbClient } from '@/app/lib/db/client'
import { useDataContext } from '@/app/lib/hooks/useDataContext'
import { formatNumber } from '@tacticus/app-core/formatters'
import PlayerBattleLog from '@/app/components/PlayerBattleLog'
import { Skeleton } from '@tacticus/ui-kit/loading'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('leaderboards.components.LeaderAnalytics')
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import {
  buildLeaderAnalyticsModel,
  isNonEmptyString,
  type GuildMetrics,
  type LeaderApiCoverageRow,
  type LeaderBattleRow,
  type LeaderGuildConfigRow,
  type LeaderPlayerMappingRow
} from './leader-analytics-model'

// Veteran = present in all of the last N seasons; matches app/lib/data/veterans.ts and the SQL.
const VETERAN_SEASON_COUNT = 5

interface LeaderAnalyticsProps {
  season: string
}

export default function LeaderAnalytics({ season }: LeaderAnalyticsProps) {
  const { context, loading: contextLoading } = useDataContext()
  const [guildMetrics, setGuildMetrics] = useState<GuildMetrics[]>([])
  const [guildLabels, setGuildLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [selectedGuildFilter, setSelectedGuildFilter] = useState<string>('all')
  const [selectedBossFilter, setSelectedBossFilter] = useState<string>('all')
  const [showBombsOnly, setShowBombsOnly] = useState(false)
  const [availableBosses, setAvailableBosses] = useState<string[]>([])

  const supabase = dbClient()

  useEffect(() => {
    const loadAnalytics = async () => {
      if (contextLoading || context.accessLevel === 'none') {
        setLoading(false)
        return
      }

      setLoading(true)

      try {
        // Deliberate .from() read: the filter column depends on access level, which an RPC cannot compose.
        let battleQuery = supabase
          .from('EOT_GR_data')
          .select(
            'displayName, userId, damageDealt, damageType, tier, set, timestamp, Name, Season, Guild, rarity, loopIndex, remainingHp, completedOn'
          )
          .eq('Season', season)
          .order('startedOn', { ascending: false })

        if (context.accessLevel === 'cluster' && context.clusterCode) {
          // SECURITY: only the user's cluster rows; a null cluster_code may hold other clusters' data.
          battleQuery = battleQuery.eq('cluster_code', context.clusterCode)
        } else if (context.accessLevel === 'guild' && context.guildCode) {
          battleQuery = battleQuery.eq('Guild', context.guildCode)
        }

        const battleData = await battleQuery

        const visibleGuildCodes = Array.from(
          new Set(
            (battleData.data ?? [])
              .map((row) => row.Guild)
              .filter((g): g is string => isNonEmptyString(g))
          )
        )

        // SECURITY INVOKER RPCs, so RLS still gates rows; p_access_level narrows scope.
        const rpcAccessLevel =
          context.accessLevel === 'cluster' || context.accessLevel === 'guild'
            ? context.accessLevel
            : 'global'
        const rpcArgs = {
          p_access_level: rpcAccessLevel,
          p_cluster_code: context.clusterCode ?? undefined,
          p_guild_code: context.guildCode ?? undefined
        }

        const guildConfigPromise = supabase.rpc(
          'get_leader_analytics_guilds',
          rpcArgs
        )
        const playerMappingPromise = supabase.rpc(
          'get_leader_analytics_player_mappings',
          rpcArgs
        )

        // Scope-specific SECURITY DEFINER RPCs (the api_key_coverage view is revoked from `authenticated`).
        const apiCoveragePromise =
          context.accessLevel === 'cluster' && context.clusterCode
            ? supabase.rpc('get_cluster_api_key_coverage', {
                p_cluster_code: context.clusterCode
              })
            : context.accessLevel === 'guild' && context.guildCode
              ? supabase.rpc('get_guild_api_key_coverage', {
                  p_guild_code: context.guildCode
                })
              : Promise.resolve({ data: [], error: null })

        const veteranCountsPromise =
          visibleGuildCodes.length > 0
            ? supabase.rpc('get_veteran_counts_by_guild', {
                p_guild_codes: visibleGuildCodes,
                p_season_count: VETERAN_SEASON_COUNT
              })
            : Promise.resolve({ data: [], error: null })

        const [
          guildConfigData,
          playerMappingData,
          apiCoverageData,
          veteranCountsData
        ] = await Promise.all([
          guildConfigPromise,
          playerMappingPromise,
          apiCoveragePromise,
          veteranCountsPromise
        ])
        if (battleData.error) throw battleData.error
        if (guildConfigData.error) throw guildConfigData.error
        if (apiCoverageData.error) {
          // Surface it: defaulting to [] hides grant regressions.
          logger.error(
            {
              err: apiCoverageData.error,
              accessLevel: context.accessLevel,
              cluster: context.clusterCode,
              guild: context.guildCode
            },
            'api_key_coverage RPC failed'
          )
        }
        if (veteranCountsData.error) {
          logger.error(
            { err: veteranCountsData.error, guilds: visibleGuildCodes.length },
            'get_veteran_counts_by_guild RPC failed'
          )
        }
        const data: LeaderBattleRow[] = battleData.data ?? []
        const guildConfigs: LeaderGuildConfigRow[] = guildConfigData.data ?? []
        const playerMappings: LeaderPlayerMappingRow[] =
          playerMappingData.data ?? []
        const apiCoverage: LeaderApiCoverageRow[] =
          (apiCoverageData.data as LeaderApiCoverageRow[] | null) ?? []
        const veteranCountByGuild = new Map<string, number>()
        for (const row of veteranCountsData.data ?? []) {
          veteranCountByGuild.set(row.guild_code, row.veteran_count)
        }

        const model = buildLeaderAnalyticsModel({
          battles: data,
          guildConfigs,
          playerMappings,
          apiCoverage,
          veteranCountByGuild
        })
        setAvailableBosses(model.availableBosses)
        setGuildLabels(model.guildLabels)
        setGuildMetrics(model.metrics)
      } catch (error) {
        logger.error({ err: error }, 'Error loading analytics:')
      } finally {
        setLoading(false)
      }
    }

    loadAnalytics()
  }, [season, supabase, context, contextLoading])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-green-500'
      case 'partial':
        return 'text-yellow-500'
      case 'disconnected':
        return 'text-red-500'
      default:
        return 'text-secondary-wh40k'
    }
  }

  const connectionColumns: DataTableColumn<GuildMetrics>[] = [
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      render: (guild) => (
        <span className="font-bold text-(--primary)">
          {guildLabels[guild.guild] ??
            formatGuildDisplayLabel(null, guild.guild)}
        </span>
      )
    },
    {
      key: 'activePlayers',
      header: 'Active Players',
      sortable: false,
      render: (guild) => (
        <span className="text-primary-wh40k">{guild.totalRosterPlayers}</span>
      )
    },
    {
      key: 'claimedProfiles',
      header: 'Profiles Claimed',
      sortable: false,
      render: (guild) => (
        <span className="font-medium text-primary-wh40k">
          {guild.claimedProfiles}/{guild.totalRosterPlayers}
        </span>
      )
    },
    {
      key: 'apiKeyStatus',
      header: 'Player API Status',
      sortable: false,
      render: (guild) => (
        <span className={`font-medium ${getStatusColor(guild.apiKeyStatus)}`}>
          {guild.playersWithApiKey || 0}/{guild.totalRosterPlayers}
        </span>
      )
    },
    {
      key: 'guildApiStatus',
      header: 'Guild Leader API',
      sortable: false,
      render: (guild) => (
        <span
          className={
            guild.guildApiStatus === 'configured'
              ? 'text-green-400'
              : 'text-red-400'
          }
        >
          {guild.guildApiStatus === 'configured'
            ? 'Configured'
            : 'Not configured'}
        </span>
      )
    },
    {
      key: 'lastDataUpdate',
      header: 'Last Update',
      sortable: false,
      render: (guild) =>
        guild.lastDataUpdate ? (
          <ClientDate date={guild.lastDataUpdate} format="full" />
        ) : (
          '--'
        )
    }
  ]

  const performanceColumns: DataTableColumn<GuildMetrics>[] = [
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      render: (guild) => (
        <span className="font-bold text-(--primary)">
          {guildLabels[guild.guild] ??
            formatGuildDisplayLabel(null, guild.guild)}
        </span>
      )
    },
    {
      key: 'totalDamage',
      header: 'Total DMG',
      sortable: false,
      render: (guild) => (
        <span className="text-(--accent-wh40k)">
          {formatNumber(guild.totalDamage)}
        </span>
      )
    },
    {
      key: 'avgDamagePerPlayer',
      header: 'Avg/Player',
      sortable: false,
      render: (guild) => (
        <span className="text-primary-wh40k">
          {formatNumber(guild.avgDamagePerPlayer)}
        </span>
      )
    },
    {
      key: 'avgTokensPerPlayer',
      header: 'Avg Tokens',
      sortable: false,
      render: (guild) => (
        <span className="text-primary-wh40k">
          {guild.avgTokensPerPlayer.toFixed(1)}
        </span>
      )
    },
    {
      key: 'bombCount',
      header: '# Bombs',
      sortable: false,
      render: (guild) => (
        <span className="text-primary-wh40k">{guild.bombCount}</span>
      )
    },
    {
      key: 'totalBattles',
      header: 'Total Tokens',
      sortable: false,
      render: (guild) => (
        <span className="text-primary-wh40k">
          {formatNumber(guild.totalBattles)}
        </span>
      )
    },
    {
      key: 'finalLoop',
      header: 'Final Loop',
      sortable: false,
      render: (guild) => (
        <span className="text-primary-wh40k">{guild.finalLoop}</span>
      )
    }
  ]

  if (!contextLoading && context.accessLevel === 'none') {
    return (
      <div className="p-8 text-center">
        <div className="text-red-500 text-lg font-bold mb-2">Access Denied</div>
        <div className="text-secondary-wh40k">
          You must be a member of a guild to view analytics
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent)_50%,transparent)] rounded-lg p-4">
        <p className="text-(--accent) text-sm">
          {context.accessLevel === 'cluster'
            ? 'Showing analytics for all guilds in your cluster'
            : 'Showing analytics for your guild only'}
        </p>
      </div>

      {loading || contextLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ) : (
        <>
          {/* API Connection Status */}
          <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg overflow-hidden">
            <div className="p-4 border-b border-(--card-border)">
              <h3 className="text-xl font-bold text-primary-wh40k">
                Guild Connection Status
              </h3>
            </div>
            {/* Desktop Table */}
            <div className="hidden lg:block">
              <DataTable
                rows={guildMetrics}
                columns={connectionColumns}
                rowKey={(guild) => guild.guild}
                empty={<></>}
              />
            </div>

            {/* Mobile Cards */}
            <div className="lg:hidden space-y-4">
              {guildMetrics.map((guild) => (
                <div
                  key={guild.guild}
                  className="bg-(--bg-secondary) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-bold text-(--primary) text-lg">
                      {guildLabels[guild.guild] ??
                        formatGuildDisplayLabel(null, guild.guild)}
                    </h4>
                    <div className="text-right">
                      <div className="text-sm text-secondary-wh40k">
                        Active Players
                      </div>
                      <div className="font-bold text-primary-wh40k">
                        {guild.totalRosterPlayers}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-secondary-wh40k text-xs mb-1">
                        Profiles Claimed
                      </div>
                      <div className="font-medium text-primary-wh40k">
                        {guild.claimedProfiles}/{guild.totalRosterPlayers}
                      </div>
                    </div>
                    <div>
                      <div className="text-secondary-wh40k text-xs mb-1">
                        Player API Status
                      </div>
                      <div
                        className={`font-medium ${getStatusColor(guild.apiKeyStatus)}`}
                      >
                        {guild.playersWithApiKey || 0}/
                        {guild.totalRosterPlayers}
                      </div>
                    </div>
                    <div>
                      <div className="text-secondary-wh40k text-xs mb-1">
                        Guild Leader API
                      </div>
                      <div>
                        <span
                          className={
                            guild.guildApiStatus === 'configured'
                              ? 'text-green-400 text-xs'
                              : 'text-red-400 text-xs'
                          }
                        >
                          {guild.guildApiStatus === 'configured'
                            ? 'Configured'
                            : 'Not configured'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-secondary-wh40k text-xs mb-1">
                        Last Update
                      </div>
                      <div className="text-secondary-wh40k text-xs">
                        {guild.lastDataUpdate ? (
                          <ClientDate
                            date={guild.lastDataUpdate}
                            format="full"
                          />
                        ) : (
                          '--'
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Guild Performance Metrics */}
          <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg overflow-hidden">
            <div className="p-4 border-b border-(--card-border)">
              <h3 className="text-xl font-bold text-primary-wh40k">
                Guild Performance Metrics
              </h3>
            </div>
            <DataTable
              rows={guildMetrics}
              columns={performanceColumns}
              rowKey={(guild) => guild.guild}
              empty={<></>}
            />
          </div>

          {/* Complete Battle Log with Filters */}
          <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 border border-(--card-border) rounded-lg p-4">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-primary-wh40k mb-4">
                Complete Battle Log
              </h3>
              <div className="flex flex-wrap gap-4">
                <div>
                  <label className="block text-sm text-secondary-wh40k mb-1">
                    Guild
                  </label>
                  <select
                    value={selectedGuildFilter}
                    onChange={(e) => setSelectedGuildFilter(e.target.value)}
                    className="px-3 py-1 bg-(--card-bg) text-primary-wh40k border border-(--card-border) rounded-sm"
                  >
                    <option value="all">All Guilds</option>
                    {guildMetrics.map((g) => (
                      <option key={g.guild} value={g.guild}>
                        {guildLabels[g.guild] ??
                          formatGuildDisplayLabel(null, g.guild)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-secondary-wh40k mb-1">
                    Boss
                  </label>
                  <select
                    value={selectedBossFilter}
                    onChange={(e) => setSelectedBossFilter(e.target.value)}
                    className="px-3 py-1 bg-(--card-bg) text-primary-wh40k border border-(--card-border) rounded-sm"
                  >
                    <option value="all">All Bosses</option>
                    {availableBosses.map((boss) => (
                      <option key={boss} value={boss}>
                        {boss}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showBombsOnly}
                      onChange={(e) => setShowBombsOnly(e.target.checked)}
                      className="rounded-sm"
                    />
                    <span className="text-sm text-secondary-wh40k">
                      Bombs Only
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Use the existing PlayerBattleLog component with modified props */}
            <PlayerBattleLog
              playerName={selectedGuildFilter === 'all' ? '' : undefined}
              guild={
                selectedGuildFilter === 'all' ? undefined : selectedGuildFilter
              }
              season={season}
              showAllGuilds={selectedGuildFilter === 'all'}
              bossFilter={
                selectedBossFilter === 'all' ? undefined : selectedBossFilter
              }
              bombsOnly={showBombsOnly}
              guildLabels={guildLabels}
            />
          </div>
        </>
      )}
    </div>
  )
}
