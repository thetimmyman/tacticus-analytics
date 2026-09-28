'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import {
  MechanicusEmptyState as EmptyState,
  LoadingSpinner,
  Skeleton
} from '@tacticus/ui-kit/loading'
import PlayerBattleLog from '@/app/components/PlayerBattleLog'
import TokenAlertNudgeCard from '@/app/components/token-usage/TokenAlertNudgeCard'
import { usePlayerStatsController } from '@/app/components/playerstats/hooks/usePlayerStatsController'
import { PlayerStatsDisplay } from './PlayerStatsDisplay'
import { usePlayerSearchOptimized } from '@/app/lib/hooks/usePerformanceOptimized'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { StickyPlayerHeader } from './StickyPlayerHeader'
import { PageAudienceNotice } from '@/app/components/ui/PageAudienceNotice'
import {
  PLAYER_STATS_AUDIENCE,
  PLAYER_STATS_AUDIENCE_FOOTNOTE
} from './player-stats-audience'

const EMPTY_PLAYERS: string[] = []

interface PlayerStatsPageProps {
  userRole: string
  userGuild: string
  userGuildName: string
  userDisplayName?: string
  clusterCode: string
  selectedSeason: string
  initialPlayerName?: string
  initialGuildCode?: string
  /** Officer search UI; default false locks the page to the signed-in user ("Your Stats"). */
  enableSearch?: boolean
}

export function PlayerStatsPage({
  userRole,
  userGuild,
  userGuildName,
  userDisplayName,
  clusterCode,
  selectedSeason,
  initialPlayerName,
  initialGuildCode,
  enableSearch = false
}: PlayerStatsPageProps) {
  const normalizedUserRole = userRole.toLowerCase()
  const canSearchOthers =
    enableSearch && canManageHeraldRole(normalizedUserRole)
  const isRestricted = !canSearchOthers
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const controller = usePlayerStatsController({
    selectedGuild: initialGuildCode || userGuild,
    selectedSeason,
    userRole: normalizedUserRole,
    userDisplayName,
    clusterCode,
    initialSearch: initialPlayerName || userDisplayName || '',
    isRestricted
  })

  const {
    state: controllerState,
    setSearchTerm,
    selectPlayer,
    fetchPlayerStats,
    clusterCode: resolvedClusterCodeFromController
  } = controller

  const searchTerm = controllerState.searchTerm ?? ''
  const selectedPlayer = controllerState.selection.player ?? ''
  const selectedSeasonValue = controllerState.selection.season ?? selectedSeason
  const playerStats = controllerState.stats
  const tokenAvailability = controllerState.tokens
  const supabaseError = controllerState.supabaseError
  const status = controllerState.status
  const assignments = controllerState.context?.assignments ?? null
  const playerMapping =
    controllerState.context?.mapping ?? controllerState.playerMapping ?? null
  const resolvedGuild =
    controllerState.context?.resolvedGuild ??
    controllerState.selection.guild ??
    userGuild
  const fetchedResolvedGuildName = useGuildDisplayLabel(resolvedGuild)
  const fetchedUserGuildName = useGuildDisplayLabel(userGuild)
  const resolvedGuildName =
    controllerState.context?.resolvedGuildName ??
    (resolvedGuild === userGuild
      ? userGuildName || fetchedUserGuildName
      : fetchedResolvedGuildName)
  const displayUserGuildName = userGuildName || fetchedUserGuildName
  const resolvedClusterCode =
    controllerState.context?.resolvedClusterCode ??
    resolvedClusterCodeFromController ??
    clusterCode

  const availablePlayers = useMemo(() => {
    const players = controllerState.availablePlayers
    return Array.isArray(players) ? players : EMPTY_PLAYERS
  }, [controllerState.availablePlayers])

  const playerObjects = useMemo(() => {
    return availablePlayers.map((player) => ({ display_name: player }))
  }, [availablePlayers])

  const optimizedResults = usePlayerSearchOptimized(
    playerObjects,
    searchTerm,
    10 // Limit to 10 results for UI
  )

  const filteredPlayers = useMemo(() => {
    const term = searchTerm.trim()
    if (!term) return availablePlayers

    if (term.length >= 2) {
      return optimizedResults.map((result) => result.display_name ?? '')
    }

    return availablePlayers.filter((player) =>
      player.toLowerCase().includes(term.toLowerCase())
    )
  }, [availablePlayers, searchTerm, optimizedResults])

  const handleSearchTermChange = useCallback(
    (value: string) => {
      if (isRestricted) return
      setSearchTerm(value)
      setShowDropdown(value.trim().length > 0)
    },
    [isRestricted, setSearchTerm]
  )

  const handlePlayerSelect = useCallback(
    (player: string) => {
      if (!player) return
      selectPlayer(player)
      setShowDropdown(false)
    },
    [selectPlayer]
  )

  const handleClear = useCallback(() => {
    setSearchTerm('')
    setShowDropdown(false)
    if (!isRestricted) {
      selectPlayer('')
    }
  }, [isRestricted, selectPlayer, setSearchTerm])

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (isRestricted) return
      if (filteredPlayers.length === 1) {
        handlePlayerSelect(filteredPlayers[0]!)
        return
      }
      const exactMatch = filteredPlayers.find(
        (player) => player.toLowerCase() === searchTerm.trim().toLowerCase()
      )
      if (exactMatch) {
        handlePlayerSelect(exactMatch)
      }
    },
    [filteredPlayers, handlePlayerSelect, isRestricted, searchTerm]
  )

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!showDropdown) return
      const target = event.target as Node
      if (dropdownRef.current && dropdownRef.current.contains(target)) return
      if (inputRef.current && inputRef.current.contains(target)) return
      setShowDropdown(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  useEffect(() => {
    if (selectedPlayer) {
      setShowDropdown(false)
    }
  }, [selectedPlayer])

  const historicalPerformanceData = useMemo(() => {
    const stats = controllerState.stats
    if (!stats?.historicalPerformance) return null

    const seasons = Object.keys(stats.historicalPerformance)
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a))

    if (seasons.length === 0) return null

    const radarData = seasons.map((seasonKey) => {
      const entry = stats.historicalPerformance?.[seasonKey]
      return {
        season: `S${seasonKey}`,
        seasonNumber: Number(seasonKey),
        vsGuild: entry?.vsGuild ?? 0,
        vsCluster: entry?.vsCluster ?? 0,
        clusterRank: entry?.clusterRank,
        clusterTotal: entry?.totalPlayersInCluster,
        guildRank: entry?.guildRank,
        guildTotal: entry?.totalPlayersInGuild,
        tokens: stats.historicalTokens?.[seasonKey] ?? 0,
        totalDamage: stats.historicalTotalDamage?.[seasonKey] ?? 0,
        reliability: stats.historicalReliability?.[seasonKey] ?? null
      }
    })

    const recent = radarData.slice(0, 5)
    const average = (values: typeof radarData, key: 'vsGuild' | 'vsCluster') =>
      values.length > 0
        ? values.reduce((sum, item) => sum + (item[key] ?? 0), 0) /
          values.length
        : 0

    return {
      fiveSeasonAvgGuild: average(recent, 'vsGuild'),
      fiveSeasonAvgCluster: average(recent, 'vsCluster'),
      radarData
    }
  }, [controllerState.stats])

  const isLoading = status === 'loading'
  const showInitialSkeleton = isLoading && !playerStats
  const showEmptyState = status === 'success' && !playerStats

  const currentPlayerId = playerMapping?.player_id?.trim() || null
  const currentPlayerName =
    playerMapping?.display_name?.trim() ||
    selectedPlayer ||
    userDisplayName ||
    'Unknown Player'
  const playerComponentKey = currentPlayerId || currentPlayerName
  const showBackToMyStats =
    canSearchOthers &&
    Boolean(selectedPlayer) &&
    selectedPlayer !== (userDisplayName || '')

  return (
    <>
      {/* No key: remounting would reset the condensed scroll state. */}
      <StickyPlayerHeader
        playerName={currentPlayerName}
        guildName={resolvedGuildName}
        season={selectedSeasonValue}
        showBackButton={showBackToMyStats}
        onBackClick={() => handlePlayerSelect(userDisplayName || '')}
      />

      <div className="container mx-auto p-6 space-y-6">
        <PageAudienceNotice
          audience={PLAYER_STATS_AUDIENCE}
          footnote={PLAYER_STATS_AUDIENCE_FOOTNOTE}
        />

        {canSearchOthers && (
          <Card>
            <CardHeader>
              <CardTitle>Player Search</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-4 md:flex-row md:items-center"
              >
                <div className="relative flex-1">
                  <Input
                    ref={inputRef}
                    type="text"
                    value={searchTerm}
                    onChange={(event) =>
                      handleSearchTermChange(event.target.value)
                    }
                    placeholder="Search player name..."
                    className="w-full"
                  />
                  {showDropdown && filteredPlayers.length > 0 && (
                    <div
                      ref={dropdownRef}
                      className="absolute z-50 w-full mt-1 rounded-lg max-h-60 overflow-y-auto dropdown-menu"
                    >
                      {filteredPlayers.slice(0, 10).map((player, index) => (
                        <button
                          key={player}
                          type="button"
                          onClick={() => handlePlayerSelect(player)}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-(--card-hover) text-primary-wh40k font-medium transition-colors ${
                            index === 0 ? 'rounded-t-lg' : ''
                          } ${
                            index === Math.min(filteredPlayers.length, 10) - 1
                              ? 'rounded-b-lg'
                              : ''
                          }`}
                          style={{ color: 'var(--text-primary)', opacity: 1 }}
                        >
                          <span className="block truncate">{player}</span>
                        </button>
                      ))}
                      {filteredPlayers.length === 0 && (
                        <div className="px-4 py-2 text-sm text-secondary-wh40k">
                          No players found
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Select player"
                    value={selectedPlayer}
                    onChange={(event) => handlePlayerSelect(event.target.value)}
                    className="min-w-[200px] px-3 py-2 border border-(--card-border) rounded-md bg-(--card-bg) text-primary-wh40k"
                    disabled={availablePlayers.length === 0}
                  >
                    <option value="">Select a player</option>
                    {availablePlayers.map((player) => (
                      <option key={player} value={player}>
                        {player}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClear}
                  >
                    Clear
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {!canSearchOthers && (
          <Card>
            <CardHeader>
              <CardTitle>Player Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Viewing statistics for {userDisplayName || 'your account'} •
                Season {selectedSeasonValue}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Gated on `!enableSearch`, outside the `playerStats` gate so members without battles see it. */}
        {!enableSearch && <TokenAlertNudgeCard />}
        {supabaseError && (
          <Card className="border-red-700 bg-red-950/40">
            <CardHeader>
              <CardTitle className="text-red-300 text-sm">
                Supabase Warning
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-red-100 space-y-2">
              <div>
                {supabaseError.message ||
                  'An unexpected error occurred while fetching data.'}
              </div>
              <div className="text-xs opacity-70">
                The rest of the page remains available so you can inspect
                current data. You can retry the request if needed.
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-red-500 text-red-200 hover:bg-red-900/30"
                onClick={() => {
                  fetchPlayerStats()
                }}
              >
                Retry Fetch
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading && playerStats && (
          <Card>
            <CardContent className="flex items-center gap-2 text-sm text-secondary-wh40k">
              <LoadingSpinner size="sm" />
              <span>Refreshing player data…</span>
            </CardContent>
          </Card>
        )}

        {showInitialSkeleton && (
          <Card>
            <CardContent className="space-y-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-64" />
            </CardContent>
          </Card>
        )}

        {showEmptyState && (
          <EmptyState
            title="Select a player to begin"
            description="Choose a guild member to view performance, reliability, and token history. Use the player search to load their dashboard."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDropdown(true)
                  inputRef.current?.focus()
                }}
              >
                Open player search
              </Button>
            }
          />
        )}

        {playerStats && (
          <PlayerStatsDisplay
            key={playerComponentKey}
            playerStats={playerStats}
            tokenAvailability={tokenAvailability}
            assignments={assignments}
            playerMapping={playerMapping}
            playerName={currentPlayerName}
            guildName={resolvedGuildName}
            resolvedGuildCode={resolvedGuild}
            selectedSeason={selectedSeasonValue}
            userRole={normalizedUserRole}
            clusterCode={resolvedClusterCode}
            historicalPerformanceData={historicalPerformanceData}
            userGuildCode={userGuild}
            userGuildName={displayUserGuildName}
          />
        )}

        {playerStats && (
          <Card>
            <CardHeader>
              <CardTitle>Battle Log</CardTitle>
            </CardHeader>
            <CardContent>
              <PlayerBattleLog
                playerName={selectedPlayer}
                selectedGuild={resolvedGuild}
                selectedSeason={selectedSeasonValue}
                showAllGuilds={false}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <HowThisWorksSection />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function HowThisWorksSection() {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
      >
        <h3 className="text-lg font-semibold text-primary-wh40k">
          How This Works
        </h3>
        <svg
          className={`h-5 w-5 text-secondary-wh40k transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="space-y-4 text-sm text-secondary-wh40k">
          <div>
            <h4 className="text-base font-semibold text-(--accent)">
              Overview Statistics
            </h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Vs averages compare your damage output to guild and cluster
                peers on matching bosses.
              </li>
              <li>
                Reliability blends consistency, standard deviation, and battle
                count to spotlight dependable players.
              </li>
              <li>
                Token usage highlights how efficiently tokens and bombs convert
                into damage.
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-base font-semibold text-(--accent)">
              Historical Trends
            </h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Charts track season over season progress with optional
                five-season smoothing.
              </li>
              <li>
                Toggle guild or cluster comparisons to focus on the benchmark
                that matters to you.
              </li>
              <li>
                Reliability, tokens, and damage per hit surface long-term growth
                or regression.
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-base font-semibold text-(--accent)">
              Assignments
            </h4>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Primary and secondary assignments mirror roster planning to keep
                coverage predictable.
              </li>
              <li>
                Token availability pulls from the latest sync so officers can
                spot bottlenecks quickly.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
