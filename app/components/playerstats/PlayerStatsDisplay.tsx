'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'
import { Users, ExternalLink } from 'lucide-react'
import {
  PlayerOverview,
  HistoricalPerformanceSection
} from '@/app/components/playerstats/OverviewTab'
import { ProfileTab } from '@/app/components/playerstats/ProfileTab'
import { RaidTeamsTab } from '@/app/components/playerstats/RaidTeamsTab'
import { DamageTrendsChart } from '@/app/components/playerstats/DamageTrendsChart'
import { MemberName } from '@/app/components/ui/MemberName'
import type {
  PlayerStats,
  TokenAvailability,
  BossAssignmentDetails,
  PlayerMapping
} from '@/app/components/playerstats/types'

interface HistoricalPerformancePoint {
  season: string
  seasonNumber: number
  vsGuild: number
  vsCluster: number
  clusterRank?: number
  clusterTotal?: number
  guildRank?: number
  guildTotal?: number
  tokens: number
  totalDamage: number
  reliability: number | null
}

interface HistoricalPerformanceData {
  fiveSeasonAvgGuild: number
  fiveSeasonAvgCluster: number
  radarData: HistoricalPerformancePoint[]
}

interface PlayerStatsDisplayProps {
  playerStats: PlayerStats
  tokenAvailability: TokenAvailability | null
  assignments: BossAssignmentDetails | null
  playerMapping: PlayerMapping | null
  playerName: string
  guildName: string
  resolvedGuildCode: string
  selectedSeason: string
  userRole: string
  clusterCode: string
  historicalPerformanceData: HistoricalPerformanceData | null
  userGuildCode?: string
  userGuildName?: string
}

export function PlayerStatsDisplay({
  playerStats,
  tokenAvailability,
  assignments,
  playerMapping,
  playerName,
  guildName,
  resolvedGuildCode,
  selectedSeason,
  userRole,
  clusterCode,
  historicalPerformanceData,
  userGuildCode = '',
  userGuildName = ''
}: PlayerStatsDisplayProps) {
  const hasValidCluster =
    Boolean(clusterCode) ||
    playerStats.vsClusterAvg != null ||
    (playerStats.totalPlayersInCluster ?? 0) > 0 ||
    (playerStats.clusterRanking ?? 0) > 0
  const showClusterMetrics = true // Show cluster metrics when available

  const [activeTab, setActiveTab] = useState('overview')
  const tabs = useMemo(() => {
    const base = [
      { value: 'overview', label: 'Overview' },
      { value: 'performance-trends', label: 'Performance Trends' },
      { value: 'raid-teams', label: 'Raid Teams' },
      { value: 'profile', label: 'Profile & Assignments' },
      { value: 'damage-trends', label: 'Damage Trends' }
    ]
    return base
  }, [])

  const hasQuickLinks =
    playerMapping &&
    (playerMapping.player_id || playerMapping.tacticus_share_url)
  const showRosterLink =
    playerMapping?.player_id && ['officer', 'leader'].includes(userRole)

  return (
    <Card className="border border-[var(--card-border)] bg-[var(--card-bg)]">
      <CardHeader className="space-y-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-xl font-semibold text-[var(--text-primary)]">
            Performance Insights • Season {selectedSeason}
          </CardTitle>
          {hasQuickLinks && (
            <div className="flex flex-wrap items-center gap-2">
              {showRosterLink && (
                <Link
                  href={`/roster/${encodeURIComponent(playerMapping.player_id!)}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-md text-[var(--accent)] transition-colors"
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">View</span> Roster
                </Link>
              )}
              {playerMapping?.tacticus_share_url && (
                <a
                  href={playerMapping.tacticus_share_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-md text-purple-400 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tacticus</span> Planner
                </a>
              )}
            </div>
          )}
        </div>
        <div className="text-sm text-[var(--text-secondary)]">
          <MemberName value={playerName} /> • {guildName}
          {hasValidCluster &&
            showClusterMetrics &&
            (clusterCode
              ? ` • Cluster ${clusterCode}`
              : ' • Cluster metrics available')}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <PageTabsSubnav
            ariaLabel="Player Stats sections"
            value={activeTab}
            onValueChange={setActiveTab}
            tabs={tabs}
          />
          {activeTab === 'overview' && (
            <PlayerOverview
              playerStats={playerStats}
              tokenAvailability={tokenAvailability}
              hasValidCluster={hasValidCluster && showClusterMetrics}
              selectedSeason={selectedSeason}
              playerName={playerName}
              guildCode={resolvedGuildCode}
              userGuildCode={userGuildCode}
              userGuildName={userGuildName}
              guildName={guildName}
            />
          )}
          {activeTab === 'performance-trends' &&
            (historicalPerformanceData &&
            historicalPerformanceData.radarData.length > 0 ? (
              <HistoricalPerformanceSection
                data={historicalPerformanceData}
                hasValidCluster={hasValidCluster && showClusterMetrics}
                selectedSeason={selectedSeason}
              />
            ) : (
              <div className="space-y-4 animate-pulse">
                <div className="h-6 w-64 bg-[var(--card-border)] rounded" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="h-64 bg-[var(--card-border)] rounded-lg" />
                  <div className="h-64 bg-[var(--card-border)] rounded-lg" />
                </div>
                <div className="h-48 bg-[var(--card-border)] rounded-lg" />
              </div>
            ))}
          {activeTab === 'raid-teams' && (
            <RaidTeamsTab
              playerName={playerName}
              guildCode={resolvedGuildCode}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileTab
              playerMapping={playerMapping}
              assignments={assignments}
              tokenAvailability={tokenAvailability}
              playerStats={playerStats}
              resolvedGuildCode={resolvedGuildCode}
              resolvedGuildName={guildName}
              userRole={userRole}
              hasValidCluster={hasValidCluster && showClusterMetrics}
            />
          )}
          {activeTab === 'damage-trends' && (
            <DamageTrendsChart
              playerName={playerName}
              guildCode={resolvedGuildCode}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
