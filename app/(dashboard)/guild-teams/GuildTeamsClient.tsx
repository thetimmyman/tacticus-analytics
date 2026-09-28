'use client'

import { Spinner } from '@tacticus/ui-kit'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Image from 'next/image'
import { dbClient } from '@/app/lib/db/client'
import {
  RAID_TEAMS,
  type RaidTeamDefinition,
  type RaidTeamHero
} from '@/app/lib/constants/guild-raid-teams'
import { Crown, RefreshCw } from 'lucide-react'
import { HeroRosterCell } from './components/HeroRosterCell'
import { CustomTeamBuilder } from './components/CustomTeamBuilder'
import { castRpcResult } from '@tacticus/app-core/database-extensions'
import { Card, CardContent } from '@tacticus/ui-kit'
import { getRankIndexFromName } from '@/app/(dashboard)/roster/utils/roster-helpers'
import { MemberName } from '@/app/components/ui/MemberName'
import { formatRelativeTime } from '@/app/(dashboard)/guild-management/members/components/utils'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { useMediaQuery } from '@/app/lib/hooks/useMediaQuery'
import type { GuildTeamRosterEntry } from './types'
import {
  TIER_LABELS,
  TIER_BG,
  TOKEN_CAP,
  heroScore,
  weightedHeroScore,
  type GuildTeamsClientProps,
  type PlayerTokenInfo,
  type SortField,
  type SortDirection
} from './guild-teams-shared'
import {
  RosterTokenTooltip,
  type RosterTooltipHandle
} from './RosterTokenTooltip'
import { GuildTeamsToolbar } from './GuildTeamsToolbar'
import { GuildTeamsDesktopTable } from './GuildTeamsDesktopTable'

export function GuildTeamsClient({
  guildCode,
  heroMappings,
  pageTitle
}: GuildTeamsClientProps) {
  const [selectedTeamId, setSelectedTeamId] = useState(
    RAID_TEAMS[0]?.id ?? 'custom'
  )
  const [rosterData, setRosterData] = useState<GuildTeamRosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [sortHeroUnitId, setSortHeroUnitId] = useState<string | null>(null)
  const [minStars, setMinStars] = useState(0)
  const [minRank, setMinRank] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [selectedHeroUnitIds, setSelectedHeroUnitIds] =
    useState<Set<string> | null>(null)
  const [heroFilterOpen, setHeroFilterOpen] = useState(false)
  const heroFilterRef = useRef<HTMLDivElement>(null)

  const [customHeroes, setCustomHeroes] = useState<RaidTeamHero[]>([])

  const supabase = dbClient()
  const backfillTriggered = useRef(false)

  const hasMounted = useHasMounted()

  // JS-gated cards below lg (CSS dual-render doubles a large DOM); the SSR default is safe.
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // Token/bomb state for the tooltip, keyed by exact and normalized name.
  const [tokenMap, setTokenMap] = useState<Map<string, PlayerTokenInfo>>(
    () => new Map()
  )
  // Hover drives the tooltip via a ref so the large table never re-renders.
  const tooltipRef = useRef<RosterTooltipHandle>(null)
  const showTooltip = useCallback(
    (name: string, info: PlayerTokenInfo, x: number, y: number) => {
      tooltipRef.current?.show(name, info, x, y)
    },
    []
  )
  const hideTooltip = useCallback(() => {
    tooltipRef.current?.hide()
  }, [])

  const selectedTeam = useMemo<RaidTeamDefinition>(() => {
    if (selectedTeamId === 'custom') {
      return { id: 'custom', name: 'Custom', heroes: customHeroes }
    }
    return (
      RAID_TEAMS.find((t) => t.id === selectedTeamId) ?? {
        id: 'custom',
        name: 'Custom',
        heroes: customHeroes
      }
    )
  }, [selectedTeamId, customHeroes])

  const fetchRosterData = useCallback(
    // `silent` re-queries without clearing the table or showing the full spinner.
    async (team: RaidTeamDefinition, opts?: { silent?: boolean }) => {
      if (team.heroes.length === 0) {
        setRosterData([])
        setLoading(false)
        return
      }
      if (opts?.silent) setRefreshing(true)
      else setLoading(true)
      setError(null)

      const unitIds = team.heroes.map((h) => h.unitId)

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'get_guild_team_roster',
        {
          p_guild_code: guildCode,
          p_unit_ids: unitIds
        }
      )
      const data = castRpcResult<GuildTeamRosterEntry[]>(rpcData)

      if (rpcError) {
        setError(rpcError.message)
        setRosterData([])
      } else {
        setRosterData((data ?? []) as GuildTeamRosterEntry[])
      }

      setLoading(false)
      setRefreshing(false)
    },
    [guildCode, supabase]
  )

  useEffect(() => {
    // Debounced: hero add/remove changes often.
    const delay = selectedTeamId === 'custom' ? 500 : 0
    const timer = setTimeout(() => {
      fetchRosterData(selectedTeam)
    }, delay)
    return () => clearTimeout(timer)
  }, [selectedTeam, fetchRosterData, selectedTeamId])

  useEffect(() => {
    if (backfillTriggered.current) return
    backfillTriggered.current = true

    fetch('/api/guild-teams/backfill', { method: 'POST' })
      .then((res) => res.json())
      .then((result: { processed?: number }) => {
        if (result.processed && result.processed > 0) {
          fetchRosterData(selectedTeam)
        }
      })
      .catch(() => {
        /* backfill is best-effort */
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Background sync runs every 5-30 min: poll silently every 60s while visible, and on focus.
  useEffect(() => {
    const REFRESH_MS = 60_000
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        fetchRosterData(selectedTeam, { silent: true })
      }
    }
    const interval = setInterval(refresh, REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [selectedTeam, fetchRosterData])

  const lastSynced = useMemo(() => {
    let max: string | null = null
    for (const entry of rosterData) {
      if (entry.synced_at && (!max || entry.synced_at > max)) {
        max = entry.synced_at
      }
    }
    return max
  }, [rosterData])

  // From the cached endpoint; the live one fans out to Tacticus per player.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/guild-teams/tokens?guild=${encodeURIComponent(guildCode)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: PlayerTokenInfo[]) => {
        if (cancelled) return
        const map = new Map<string, PlayerTokenInfo>()
        for (const row of rows ?? []) {
          if (!row?.display_name) continue
          map.set(row.display_name, row)
          map.set(`norm:${row.display_name.trim().toLowerCase()}`, row)
        }
        setTokenMap(map)
      })
      .catch(() => {
        /* hover token data is best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [guildCode])

  const tokenInfoFor = useCallback(
    (name: string): PlayerTokenInfo | null =>
      tokenMap.get(name) ??
      tokenMap.get(`norm:${name.trim().toLowerCase()}`) ??
      null,
    [tokenMap]
  )

  const { playerHeroMap, playerRoleMap } = useMemo(() => {
    const heroMap = new Map<string, Map<string, GuildTeamRosterEntry>>()
    const roleMap = new Map<string, string>()
    for (const entry of rosterData) {
      if (!entry.player_display_name) continue
      let unitMap = heroMap.get(entry.player_display_name)
      if (!unitMap) {
        unitMap = new Map()
        heroMap.set(entry.player_display_name, unitMap)
      }
      if (entry.unit_id) {
        unitMap.set(entry.unit_id, entry)
      }
      if (entry.guild_role && !roleMap.has(entry.player_display_name)) {
        roleMap.set(entry.player_display_name, entry.guild_role)
      }
    }
    return { playerHeroMap: heroMap, playerRoleMap: roleMap }
  }, [rosterData])

  const playerNames = useMemo(() => {
    let names = [...playerHeroMap.keys()]

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      names = names.filter((name) => name.toLowerCase().includes(q))
    }

    if (roleFilter !== 'all') {
      names = names.filter((name) => playerRoleMap.get(name) === roleFilter)
    }

    // Passes if ANY hero in the team meets the thresholds.
    if (minStars > 0 || minRank > 0) {
      names = names.filter((name) => {
        const heroMap = playerHeroMap.get(name)
        if (!heroMap) return false
        return selectedTeam.heroes.some((h) => {
          const entry = heroMap.get(h.unitId)
          if (!entry || entry.stars == null) return false
          const prog = entry.progression_index ?? entry.stars ?? 0
          const rank = entry.rank_name
            ? getRankIndexFromName(entry.rank_name)
            : 0
          return prog >= minStars && rank >= minRank
        })
      })
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    if (sortField === 'name') {
      names.sort((a, b) => dir * a.localeCompare(b))
    } else if (sortField === 'hero' && sortHeroUnitId) {
      names.sort((a, b) => {
        const scoreA = heroScore(playerHeroMap.get(a)?.get(sortHeroUnitId))
        const scoreB = heroScore(playerHeroMap.get(b)?.get(sortHeroUnitId))
        return dir * (scoreA - scoreB)
      })
    } else if (sortField === 'team_score') {
      const activeHeroes = selectedHeroUnitIds
        ? selectedTeam.heroes.filter((h) => selectedHeroUnitIds.has(h.unitId))
        : selectedTeam.heroes
      names.sort((a, b) => {
        const heroMapA = playerHeroMap.get(a)
        const heroMapB = playerHeroMap.get(b)
        const totalA = activeHeroes.reduce(
          (sum, h) => sum + weightedHeroScore(heroMapA?.get(h.unitId), h.tier),
          0
        )
        const totalB = activeHeroes.reduce(
          (sum, h) => sum + weightedHeroScore(heroMapB?.get(h.unitId), h.tier),
          0
        )
        return dir * (totalA - totalB)
      })
    }

    return names
  }, [
    playerHeroMap,
    playerRoleMap,
    sortField,
    sortDirection,
    sortHeroUnitId,
    minStars,
    minRank,
    searchQuery,
    roleFilter,
    selectedTeam,
    selectedHeroUnitIds
  ])

  const herosByTier = useMemo(() => {
    const tiers: { tier: string; heroes: typeof selectedTeam.heroes }[] = []
    const tierOrder = ['core', 'secondary', 'tertiary'] as const
    for (const tier of tierOrder) {
      const heroes = selectedTeam.heroes.filter((h) => h.tier === tier)
      if (heroes.length > 0) {
        tiers.push({ tier, heroes })
      }
    }
    return tiers
  }, [selectedTeam])

  const orderedHeroes = useMemo(
    () => herosByTier.flatMap((g) => g.heroes),
    [herosByTier]
  )

  const handleTeamSelect = useCallback((teamId: string) => {
    setSelectedTeamId(teamId)
    setSortField('name')
    setSortDirection('asc')
    setSortHeroUnitId(null)
    setSelectedHeroUnitIds(null)
    setHeroFilterOpen(false)
  }, [])

  const handleHeroFilterToggle = useCallback(
    (unitId: string) => {
      setSelectedHeroUnitIds((prev) => {
        const allIds = selectedTeam.heroes.map((h) => h.unitId)
        if (prev === null) {
          // From "all selected", deselect the toggled one.
          const next = new Set(allIds.filter((id) => id !== unitId))
          setSortField('team_score')
          setSortDirection('desc')
          setSortHeroUnitId(null)
          return next
        }
        const next = new Set(prev)
        if (next.has(unitId)) next.delete(unitId)
        else next.add(unitId)
        // All re-selected clears the filter.
        if (next.size >= allIds.length) return null
        // None left reverts to all.
        if (next.size === 0) return null
        setSortField('team_score')
        setSortDirection('desc')
        setSortHeroUnitId(null)
        return next
      })
    },
    [selectedTeam]
  )

  const handleHeroSort = useCallback(
    (unitId: string) => {
      if (sortField === 'hero' && sortHeroUnitId === unitId) {
        setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
      } else {
        setSortField('hero')
        setSortHeroUnitId(unitId)
        setSortDirection('desc')
      }
    },
    [sortField, sortHeroUnitId]
  )

  const handleSortFieldChange = useCallback((field: SortField) => {
    if (field !== 'hero') {
      setSortHeroUnitId(null)
    }
    setSortField(field)
    setSortDirection(field === 'name' ? 'asc' : 'desc')
  }, [])

  useEffect(() => {
    if (!heroFilterOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        heroFilterRef.current &&
        !heroFilterRef.current.contains(e.target as Node)
      ) {
        setHeroFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [heroFilterOpen])

  // Memoized so hover re-renders skip the <tbody>; rebuilding it per hover saturates the thread.
  const tableBody = useMemo(() => {
    if (playerNames.length === 0) {
      return (
        <tr>
          <td
            colSpan={orderedHeroes.length + 1}
            className="text-center py-8 text-secondary-wh40k"
          >
            No guild members with roster data found.
          </td>
        </tr>
      )
    }
    return playerNames.map((playerName, rowIdx) => {
      const heroMap = playerHeroMap.get(playerName)
      const tokenInfo = tokenInfoFor(playerName)
      return (
        <tr
          key={playerName}
          className={`${rowIdx % 2 === 0 ? 'bg-card/30' : 'bg-card/20'} hover:bg-card/30 transition-colors ${tokenInfo ? 'cursor-help' : ''}`}
          onMouseEnter={
            tokenInfo
              ? (e) => {
                  // Anchor to the sticky name cell, not the wide row.
                  const cell = e.currentTarget
                    .firstElementChild as HTMLElement | null
                  const r = (cell ?? e.currentTarget).getBoundingClientRect()
                  showTooltip(playerName, tokenInfo, r.right, r.top)
                }
              : undefined
          }
          onMouseLeave={tokenInfo ? () => hideTooltip() : undefined}
        >
          <td className="sticky left-0 z-10 bg-inherit px-3 py-1 text-sm font-medium text-primary-wh40k whitespace-nowrap border-r border-card-border/30">
            <span
              className={
                tokenInfo
                  ? 'border-b border-dotted border-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)]'
                  : undefined
              }
            >
              <MemberName value={playerName} />
            </span>
          </td>
          {orderedHeroes.map((hero, colIdx) => {
            const entry = heroMap?.get(hero.unitId) ?? null
            const previousHero = orderedHeroes[colIdx - 1]
            const isFirstInTier =
              colIdx === 0 || previousHero?.tier !== hero.tier
            const isMow =
              heroMappings[hero.unitId]?.category?.toLowerCase() === 'mow'

            return (
              <td
                key={hero.unitId}
                className={`px-0.5 py-0.5 border-card-border/20 ${isFirstInTier && colIdx > 0 ? 'border-l border-card-border/30' : ''} ${TIER_BG[hero.tier] ?? ''}`}
              >
                <HeroRosterCell data={entry} isMow={isMow} />
              </td>
            )
          })}
        </tr>
      )
    })
  }, [
    playerNames,
    playerHeroMap,
    orderedHeroes,
    heroMappings,
    tokenInfoFor,
    showTooltip,
    hideTooltip
  ])

  // Token state is inline on mobile cards since touch has no hover.
  const mobileCards = useMemo(() => {
    if (playerNames.length === 0) {
      return (
        <div className="rounded-lg border border-card-border/50 bg-card/30 py-8 text-center text-secondary-wh40k">
          No guild members with roster data found.
        </div>
      )
    }
    return playerNames.map((playerName) => {
      const heroMap = playerHeroMap.get(playerName)
      const tokenInfo = tokenInfoFor(playerName)
      const tokens = tokenInfo
        ? Math.min(
            TOKEN_CAP,
            Math.max(0, Math.round(tokenInfo.tokens_available ?? 0))
          )
        : null
      const bombReady = tokenInfo
        ? (tokenInfo.bombs_available_live ?? 0) > 0
        : false
      return (
        <div
          key={playerName}
          className="overflow-hidden rounded-lg border border-card-border/50 bg-card/30"
        >
          <div className="flex items-center justify-between gap-2 border-b border-card-border/30 px-3 py-2">
            <span className="truncate text-sm font-medium text-primary-wh40k">
              <MemberName value={playerName} />
            </span>
            {tokenInfo && (
              <span className="shrink-0 text-[10px] text-secondary-wh40k">
                {tokens}/{TOKEN_CAP} tokens ·{' '}
                {bombReady ? (
                  <span className="font-medium text-green-400">bomb ✓</span>
                ) : (
                  'bomb used'
                )}
              </span>
            )}
          </div>
          <div className="space-y-2 p-2">
            {herosByTier.map((group) => (
              <div key={group.tier}>
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-secondary-wh40k">
                  {TIER_LABELS[group.tier]}
                </div>
                <div className="grid grid-cols-3 gap-1 min-[420px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6">
                  {group.heroes.map((hero) => {
                    const entry = heroMap?.get(hero.unitId) ?? null
                    const mapping = heroMappings[hero.unitId]
                    const name = mapping?.display_name ?? hero.displayName
                    const isMow = mapping?.category?.toLowerCase() === 'mow'
                    return (
                      <div
                        key={hero.unitId}
                        className={`rounded-md border border-card-border/20 ${TIER_BG[hero.tier] ?? ''}`}
                      >
                        <div className="flex items-center justify-center gap-1 px-1 pt-1">
                          {mapping?.web_icon_url && (
                            <Image
                              src={mapping.web_icon_url}
                              alt=""
                              width={14}
                              height={14}
                              className="shrink-0 rounded-xs"
                              unoptimized
                            />
                          )}
                          <span className="truncate text-[9px] leading-tight text-secondary-wh40k">
                            {name}
                          </span>
                        </div>
                        <HeroRosterCell data={entry} isMow={isMow} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    })
  }, [playerNames, playerHeroMap, herosByTier, heroMappings, tokenInfoFor])

  const totalMembers = playerHeroMap.size

  return (
    <div className="space-y-4">
      {/* Ref-driven tooltip, so hover never re-renders this table. */}
      <RosterTokenTooltip ref={tooltipRef} />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          {pageTitle}
        </h1>
        <div className="flex items-center gap-3">
          {!loading && totalMembers > 0 && (
            <span className="text-sm text-secondary-wh40k">
              {playerNames.length === totalMembers
                ? `${totalMembers} members`
                : `${playerNames.length} / ${totalMembers} members`}
            </span>
          )}
          {!loading && lastSynced && (
            <span
              className="text-xs text-secondary-wh40k"
              title={
                hasMounted ? new Date(lastSynced).toLocaleString() : undefined
              }
            >
              Updated {formatRelativeTime(lastSynced)}
            </span>
          )}
          <button
            type="button"
            onClick={() => fetchRosterData(selectedTeam, { silent: true })}
            disabled={loading || refreshing}
            title="Refresh roster data"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-secondary-wh40k hover:text-white hover:bg-card/50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Team tabs */}
      <div className="flex gap-1 bg-card/50 p-1 rounded-lg flex-wrap">
        {RAID_TEAMS.map((team) => (
          <button
            key={team.id}
            onClick={() => handleTeamSelect(team.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedTeamId === team.id
                ? 'bg-indigo-600 text-white'
                : 'text-secondary-wh40k hover:text-white hover:bg-card/50'
            }`}
          >
            {team.name}
          </button>
        ))}
        <button
          onClick={() => handleTeamSelect('custom')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            selectedTeamId === 'custom'
              ? 'bg-indigo-600 text-white'
              : 'text-secondary-wh40k hover:text-white hover:bg-card/50'
          }`}
        >
          Custom
        </button>
      </div>

      {/* Custom team builder */}
      {selectedTeamId === 'custom' && (
        <CustomTeamBuilder
          customHeroes={customHeroes}
          onHeroesChange={setCustomHeroes}
          heroMappings={heroMappings}
        />
      )}

      {/* Sort & Filter toolbar */}
      {!loading && !error && (
        <GuildTeamsToolbar
          sortField={sortField}
          sortDirection={sortDirection}
          sortHeroUnitId={sortHeroUnitId}
          selectedTeam={selectedTeam}
          heroMappings={heroMappings}
          heroFilterRef={heroFilterRef}
          heroFilterOpen={heroFilterOpen}
          selectedHeroUnitIds={selectedHeroUnitIds}
          minStars={minStars}
          minRank={minRank}
          roleFilter={roleFilter}
          searchQuery={searchQuery}
          handleSortFieldChange={handleSortFieldChange}
          handleHeroFilterToggle={handleHeroFilterToggle}
          setSortDirection={setSortDirection}
          setHeroFilterOpen={setHeroFilterOpen}
          setSelectedHeroUnitIds={setSelectedHeroUnitIds}
          setMinStars={setMinStars}
          setMinRank={setMinRank}
          setRoleFilter={setRoleFilter}
          setSearchQuery={setSearchQuery}
        />
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          Failed to load roster data: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" className="text-indigo-500" />
        </div>
      )}

      {/* Mobile/tablet: player cards (no horizontal scroll). */}
      {!loading && !error && !isDesktop && (
        <div className="space-y-2.5">{mobileCards}</div>
      )}

      {/* Table */}
      {!loading && !error && isDesktop && (
        <GuildTeamsDesktopTable
          herosByTier={herosByTier}
          orderedHeroes={orderedHeroes}
          heroMappings={heroMappings}
          sortField={sortField}
          sortDirection={sortDirection}
          sortHeroUnitId={sortHeroUnitId}
          selectedHeroUnitIds={selectedHeroUnitIds}
          handleHeroSort={handleHeroSort}
          tableBody={tableBody}
        />
      )}

      {/* Developer credit */}
      <Card className="bg-linear-to-r from-purple-500/10 to-indigo-500/10 border-purple-500/30">
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-purple-400 shrink-0" />
              <div>
                <p className="text-purple-200 font-medium">
                  Support the Developer
                </p>
                <p className="text-purple-400/70 text-sm">
                  Please support Tani with his referral code
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 rounded-lg border border-purple-500/40">
              <span className="text-purple-200 font-mono font-bold tracking-wide">
                PAD-19-MOP
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
