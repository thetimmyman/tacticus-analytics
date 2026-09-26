'use client'

import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import { useState, useEffect, useRef } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { dbClient } from '@/app/lib/db/client'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { BossLink } from '@/app/components/ui/BossLink'
import {
  buildAvatarFrameMap,
  getUserAvatar,
  resolveAvatarIconUrl,
  type AvatarFrame
} from '@/app/lib/utils/avatar'
import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import { createComponentLogger } from '@/app/lib/logging/client'
import {
  getBossLevel,
  type BattleLogEntry
} from '@/app/lib/utils/battle-log-helpers'
import {
  useBattleLogData,
  type QueryModifier
} from '@/app/lib/hooks/useBattleLogData'
import {
  BattleLogEntryRow,
  BattleLogPagination
} from '@/app/components/ui/BattleLogTable'

const logger = createComponentLogger('components.BattleLog')

interface PlayerAvatarMapping {
  display_name: string
  avatar_unit_id: string | null
}

interface BattleLogProps {
  selectedGuild: string
  selectedSeason: string
}

export default function BattleLog({
  selectedGuild,
  selectedSeason
}: BattleLogProps) {
  const hasMounted = useHasMounted()

  const [showType, setShowType] = useState<
    'all' | 'bosses' | 'prime1' | 'prime2' | 'bombs'
  >('all')
  const [playerAvatarMap, setPlayerAvatarMap] = useState<Map<string, string>>(
    new Map()
  )
  const [clusterCode, setClusterCode] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [damageFilter, setDamageFilter] = useState<
    'all' | 'high' | 'medium' | 'low'
  >('all')
  const [killingBlowsOnly, setKillingBlowsOnly] = useState(false)
  const [page, setPage] = useState(0)
  const filterValuesRef = useRef<string>('')
  const [pageSize, setPageSize] = useState(15)

  const filterKey = `${selectedGuild}|${selectedSeason}|${showType}|${searchTerm}|${damageFilter}|${killingBlowsOnly}|${pageSize}`
  useEffect(() => {
    if (filterValuesRef.current && filterValuesRef.current !== filterKey) {
      setPage(0)
    }
    filterValuesRef.current = filterKey
  }, [filterKey])

  useEffect(() => {
    let cancelled = false
    const fetch = async () => {
      if (!selectedGuild) {
        setClusterCode(null)
        return
      }
      try {
        // Uncached on purpose: GuildConfigService would pull its server cache into the bundle.
        const supabase = dbClient()
        const { data: guildConfig } = await supabase
          .from('guild_config')
          .select('cluster_code')
          .eq('guild_code', selectedGuild)
          .single()
        if (!cancelled) setClusterCode(guildConfig?.cluster_code || null)
      } catch (error) {
        if (!cancelled) {
          logger.error({ error }, 'Error getting cluster context')
          setClusterCode(null)
        }
      }
    }
    fetch()
    return () => {
      cancelled = true
    }
  }, [selectedGuild])

  const buildFilters: QueryModifier = (query) => {
    query = query.eq('Guild', selectedGuild).eq('Season', selectedSeason)
    if (showType === 'bosses')
      query = query.in('damageType', ['Battle', 'Bomb']).eq('encounterId', 0)
    else if (showType === 'prime1')
      query = query.in('damageType', ['Battle', 'Bomb']).eq('encounterId', 1)
    else if (showType === 'prime2')
      query = query.in('damageType', ['Battle', 'Bomb']).eq('encounterId', 2)
    else if (showType === 'bombs') query = query.eq('damageType', 'Bomb')
    if (searchTerm)
      query = query.or(
        `displayName.ilike.%${searchTerm}%,Name.ilike.%${searchTerm}%`
      )
    if (damageFilter === 'high') query = query.gte('damageDealt', 10000000)
    else if (damageFilter === 'medium')
      query = query.gte('damageDealt', 5000000).lt('damageDealt', 10000000)
    else if (damageFilter === 'low') query = query.lt('damageDealt', 5000000)
    if (killingBlowsOnly) query = query.eq('remainingHp', 0)
    return query
  }

  const {
    entries,
    loading,
    totalCount,
    heroMappings,
    guildPerformancePctMap,
    clusterPerformancePctMap
  } = useBattleLogData({
    guild: selectedGuild,
    season: selectedSeason,
    page,
    pageSize,
    orderBy: [
      { column: 'completedOn', ascending: false },
      { column: 'loopIndex', ascending: false },
      { column: 'set', ascending: false }
    ],
    buildFilters,
    enabled: !!(selectedGuild && selectedSeason),
    deps: [showType, searchTerm, damageFilter, killingBlowsOnly]
  })

  useEffect(() => {
    let cancelled = false
    const fetchAvatars = async () => {
      const playerNames = [
        ...new Set(
          entries
            .map((e) => e.displayName)
            .filter((n): n is string => n !== null)
        )
      ]
      if (playerNames.length === 0) return

      try {
        const supabase = dbClient()
        const { data: playerMappings } = await guildRosterQuery(
          supabase,
          selectedGuild,
          'display_name, avatar_unit_id'
        ).in('display_name', playerNames)

        const { data: avatarFrames } = await supabase
          .from('player_avatar_frames')
          .select('avatar_id, icon_url')

        if (cancelled) return

        const frameMap = buildAvatarFrameMap(
          (avatarFrames as AvatarFrame[] | null) ?? []
        )

        const newMap = new Map<string, string>()
        playerMappings?.forEach((pm: PlayerAvatarMapping) => {
          if (pm.display_name) {
            const url = resolveAvatarIconUrl(pm.avatar_unit_id, frameMap)
            if (url) newMap.set(pm.display_name, url)
          }
        })
        setPlayerAvatarMap(newMap)
      } catch (error) {
        logger.error({ error }, 'Error fetching player avatars')
      }
    }
    fetchAvatars()
    return () => {
      cancelled = true
    }
  }, [entries, selectedGuild])

  const renderPlayerAvatar = (entry: BattleLogEntry) => (
    <img
      src={
        playerAvatarMap.get(entry.displayName || '') ||
        getUserAvatar(entry.displayName || 'Unknown', selectedGuild, 24)
      }
      alt=""
      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
      onError={(e) => {
        e.currentTarget.src = getUserAvatar(
          entry.displayName || 'Unknown',
          selectedGuild,
          24
        )
      }}
    />
  )

  const renderBossName = (entry: BattleLogEntry) => (
    <>
      <span className="flex-shrink-0">{getBossLevel(entry)}</span>
      <BossLink
        bossName={entry.Name ?? ''}
        className="text-[var(--primary)] truncate min-w-0"
      >
        <span className="truncate">{entry.Name}</span>
      </BossLink>
    </>
  )

  const renderPlayerName = (entry: BattleLogEntry) => (
    <span className="font-medium text-primary-wh40k truncate">
      <PlayerLink playerName={entry.displayName || 'Unknown'}>
        {entry.displayName}
      </PlayerLink>
    </span>
  )

  const groupedEntries = entries.reduce(
    (acc, entry) => {
      const set = entry.set ?? 0
      const rarity = entry.rarity || 'Unknown'
      const encounterId = entry.encounterId || 0
      const key = `${entry.loopIndex}-${set}-${rarity}-${encounterId}`
      if (!acc[key])
        acc[key] = {
          loopIndex: entry.loopIndex ?? 0,
          set,
          rarity,
          encounterId,
          entries: []
        }
      acc[key].entries.push(entry)
      return acc
    },
    {} as Record<
      string,
      {
        loopIndex: number
        set: number
        rarity: string
        encounterId: number
        entries: BattleLogEntry[]
      }
    >
  )

  Object.values(groupedEntries).forEach((group) => {
    group.entries.sort(
      (a, b) =>
        new Date(b.completedOn || 0).getTime() -
        new Date(a.completedOn || 0).getTime()
    )
  })

  const sortedGroups = Object.values(groupedEntries).sort((a, b) => {
    const aLatest = a.entries[0]
      ? new Date(a.entries[0].completedOn || 0).getTime()
      : 0
    const bLatest = b.entries[0]
      ? new Date(b.entries[0].completedOn || 0).getTime()
      : 0
    return bLatest - aLatest
  })

  return (
    <div className="card-wh40k p-3 sm:p-4 md:p-6">
      <h3 className="heading-wh40k mb-3 sm:mb-4">Battle Log</h3>

      {/* Search Bar */}
      <div className="mb-3 sm:mb-4">
        <input
          type="text"
          placeholder="Search player or boss name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary)] focus:outline-none"
        />
      </div>

      {/* Filter Controls */}
      <div className="flex flex-wrap gap-2 sm:gap-3 mb-3 sm:mb-4">
        <select
          value={damageFilter}
          onChange={(e) =>
            setDamageFilter(e.target.value as typeof damageFilter)
          }
          className="px-2 sm:px-3 py-1.5 sm:py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-xs sm:text-sm text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
        >
          <option value="all">All Damage</option>
          <option value="high">High (10M+)</option>
          <option value="medium">Medium (5-10M)</option>
          <option value="low">Low (&lt;5M)</option>
        </select>

        <label className="flex items-center space-x-1.5 sm:space-x-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg cursor-pointer hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]">
          <input
            type="checkbox"
            checked={killingBlowsOnly}
            onChange={(e) => setKillingBlowsOnly(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs sm:text-sm text-[var(--text-primary)]">
            Killing Blows Only
          </span>
        </label>

        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-2 sm:px-3 py-1.5 sm:py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-xs sm:text-sm text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
        >
          <option value="15">15 per page</option>
          <option value="25">25 per page</option>
          <option value="50">50 per page</option>
          <option value="100">100 per page</option>
        </select>
      </div>

      {/* Type Filter Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mb-3 sm:mb-4">
        {(['all', 'bosses', 'prime1', 'prime2', 'bombs'] as const).map((t) => {
          const labels: Record<string, string> = {
            all: 'All',
            bosses: 'Bosses',
            prime1: 'Prime 1',
            prime2: 'Prime 2',
            bombs: '\uD83D\uDCA3 Bombs'
          }
          const active = showType === t
          const activeColors: Record<string, string> = {
            all: 'bg-accent-wh40k text-[var(--bg-primary)]',
            bosses: 'bg-[var(--primary)] text-black',
            prime1: 'bg-[var(--accent)] text-black',
            prime2: 'bg-[var(--accent)] text-black',
            bombs: 'bg-[var(--accent)] text-black'
          }
          return (
            <button
              key={t}
              onClick={() => setShowType(t)}
              className={`px-3 py-2 rounded-lg transition-all text-sm sm:text-base ${active ? `${activeColors[t]} font-bold cursor-default` : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--card-bg)]'}`}
            >
              {labels[t]}
            </button>
          )
        })}
      </div>

      <BattleLogPagination
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        totalCount={totalCount}
        loading={loading}
      />

      {loading ? (
        <div className="py-6" role="status" aria-live="polite">
          <div className="animate-pulse space-y-2">
            {'abcdef'
              .slice(0, Math.min(pageSize, 6))
              .split('')
              .map((k) => (
                <div key={k} className="h-8 bg-[var(--card-bg)] rounded" />
              ))}
          </div>
          <p className="mt-4 text-center text-secondary-wh40k">
            {page > 0 ? `Loading page ${page + 1}...` : 'Loading battle log...'}
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-secondary-wh40k">
          Try adjusting your search or filters
        </div>
      ) : (
        <div className="space-y-4 max-h-[600px] overflow-y-auto">
          {sortedGroups.map((group) => (
            <div
              key={`${group.loopIndex}-${group.set}-${group.rarity}-${group.encounterId}`}
            >
              <div className="sticky top-0 z-10 bg-[color-mix(in_srgb,var(--bg-primary)_95%,transparent)] backdrop-blur-sm px-3 py-2 mb-2 rounded-lg border border-[var(--card-border)]">
                <h4 className="text-sm font-bold text-primary-wh40k">
                  {normalizeRarity(group.rarity)
                    ? getRarityPrefix(normalizeRarity(group.rarity)!)
                    : 'L'}
                  {group.set + 1}{' '}
                  {group.encounterId === 0
                    ? 'Bosses'
                    : `Prime ${group.encounterId}`}
                </h4>
              </div>

              <div
                className="overflow-x-auto pb-1"
                data-testid="battle-log-group-scroll"
              >
                <div className="space-y-1 px-2 sm:min-w-[1020px]">
                  {group.entries.map((entry) => (
                    <BattleLogEntryRow
                      key={entry.id}
                      entry={entry}
                      heroMappings={heroMappings}
                      guildPerformancePctMap={guildPerformancePctMap}
                      clusterPerformancePctMap={clusterPerformancePctMap}
                      clusterCode={clusterCode}
                      hasMounted={hasMounted}
                      desktopGridClassName="grid-cols-[32px,120px,180px,120px,1fr,90px,40px,40px,80px,auto]"
                      desktopPrimary={
                        <div className="flex items-center gap-2 truncate">
                          {renderPlayerAvatar(entry)}
                          {renderPlayerName(entry)}
                        </div>
                      }
                      desktopSecondary={
                        <div className="flex items-center gap-1 text-secondary-wh40k overflow-hidden min-w-0">
                          {renderBossName(entry)}
                        </div>
                      }
                      mobileIdentity={
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {renderPlayerAvatar(entry)}
                            {renderPlayerName(entry)}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-secondary-wh40k overflow-hidden min-w-0">
                            {renderBossName(entry)}
                          </div>
                        </div>
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
