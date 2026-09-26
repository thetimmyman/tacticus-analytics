'use client'

import { useEffect, useRef, useState } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { BossLink } from '@/app/components/ui/BossLink'
import { useClusterContext } from '@/app/hooks/useClusterContext'
import { getBossLevel } from '@/app/lib/utils/battle-log-helpers'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import {
  useBattleLogData,
  type QueryModifier
} from '@/app/lib/hooks/useBattleLogData'
import {
  BattleLogControls,
  BattleLogEntryRow,
  BattleLogTable
} from '@/app/components/ui/BattleLogTable'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

type PlayerBattleType = 'all' | 'battles' | 'bombs'

const PLAYER_BATTLE_FILTERS = [
  {
    value: 'all',
    label: 'All',
    activeClassName: 'bg-accent-wh40k text-[var(--bg-primary)]'
  },
  {
    value: 'battles',
    label: '\u2694\uFE0F Battles',
    activeClassName: 'bg-[var(--primary)] text-black'
  },
  {
    value: 'bombs',
    label: '\uD83D\uDCA3',
    activeClassName: 'bg-red-600 text-[var(--text-primary)]'
  }
] as const satisfies readonly {
  value: PlayerBattleType
  label: string
  activeClassName: string
}[]

interface PlayerBattleLogProps {
  selectedGuild?: string
  selectedSeason?: string
  playerName?: string
  guild?: string
  season?: string
  showAllGuilds?: boolean
  bossFilter?: string
  bombsOnly?: boolean
  guildLabels?: Record<string, string>
}

export default function PlayerBattleLog({
  selectedGuild,
  selectedSeason,
  playerName,
  guild,
  season,
  showAllGuilds = false,
  bossFilter,
  bombsOnly = false,
  guildLabels
}: PlayerBattleLogProps) {
  const renderGuildTag = (code: string): string =>
    guildLabels?.[code] ?? formatGuildDisplayLabel(null, code)
  const hasMounted = useHasMounted()
  const { clusterCode, isLoading: isClusterLoading } = useClusterContext()
  const [showType, setShowType] = useState<PlayerBattleType>(
    bombsOnly ? 'bombs' : 'all'
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(0)
  const filterValuesRef = useRef('')
  const [pageSize, setPageSize] = useState(20)

  const actualGuild = guild || selectedGuild
  const actualSeason = season || selectedSeason
  const filterKey = `${actualGuild}|${actualSeason}|${playerName}|${showType}|${showAllGuilds}|${bossFilter}|${bombsOnly}|${searchTerm}`
  useEffect(() => {
    if (filterValuesRef.current && filterValuesRef.current !== filterKey) {
      setPage(0)
    }
    filterValuesRef.current = filterKey
  }, [filterKey])

  const buildFilters: QueryModifier = (query) => {
    if (!showAllGuilds && actualGuild) query = query.eq('Guild', actualGuild)
    if (clusterCode) query = query.eq('cluster_code', clusterCode)
    if (actualSeason) query = query.eq('Season', actualSeason)
    if (playerName) query = query.eq('displayName', playerName)
    if (bossFilter) query = query.eq('Name', bossFilter)
    if (searchTerm) query = query.ilike('Name', `%${searchTerm}%`)
    if (showType === 'battles' || bombsOnly) {
      query = query.eq('damageType', bombsOnly ? 'Bomb' : 'Battle')
    } else if (showType === 'bombs') {
      query = query.eq('damageType', 'Bomb')
    }
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
    guild: actualGuild ?? null,
    season: actualSeason ?? null,
    page,
    pageSize,
    selectColumns:
      'id, displayName, Name, damageDealt, damageType, tier, set, rarity, encounterId, loopIndex, completedOn, remainingHp, maxHp, heroDetails, machineOfWarDetails, Guild',
    orderBy: [{ column: 'completedOn', ascending: false }],
    buildFilters,
    enabled: !!(
      (showAllGuilds || actualGuild) &&
      (actualSeason || showAllGuilds) &&
      !isClusterLoading
    ),
    deps: [
      showType,
      showAllGuilds,
      bossFilter,
      bombsOnly,
      clusterCode,
      isClusterLoading,
      searchTerm,
      playerName
    ]
  })

  return (
    <div className="card-wh40k p-3 sm:p-4 md:p-6">
      <div className="mb-3 sm:mb-4">
        <h3 className="heading-wh40k mb-2 text-sm sm:text-base">
          {showAllGuilds
            ? 'Complete Battle Log'
            : `${playerName || 'Player'}'s Battle Log`}
        </h3>
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search boss names..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary)] focus:outline-none"
          />
        </div>
        <BattleLogControls
          options={PLAYER_BATTLE_FILTERS}
          value={showType}
          onChange={setShowType}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          pageSizes={[20, 50, 100]}
        />
      </div>

      <BattleLogTable
        loading={loading}
        isEmpty={entries.length === 0}
        emptyTitle="No records match your search"
        emptyDescription=""
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        totalCount={totalCount}
        // Full height with page scroll; only the boss log uses the 600px inner scroll.
        maxHeight="none"
      >
        {entries.map((entry) => (
          <BattleLogEntryRow
            key={entry.id}
            entry={entry}
            heroMappings={heroMappings}
            guildPerformancePctMap={guildPerformancePctMap}
            clusterPerformancePctMap={clusterPerformancePctMap}
            clusterCode={clusterCode}
            hasMounted={hasMounted}
            desktopGridClassName="grid-cols-[32px,60px,160px,160px,1fr,90px,40px,40px,80px,auto]"
            desktopPrimary={
              <div className="truncate">
                {showAllGuilds && entry.Guild ? (
                  <span className="font-bold text-[var(--primary)]">
                    [{renderGuildTag(entry.Guild)}]
                  </span>
                ) : (
                  <span className="text-transparent">-</span>
                )}
              </div>
            }
            desktopSecondary={
              <div className="flex min-w-0 items-center gap-1 overflow-hidden text-secondary-wh40k">
                <span className="flex-shrink-0">{getBossLevel(entry)}</span>
                <BossLink
                  bossName={entry.Name ?? ''}
                  className="min-w-0 truncate text-yellow-400"
                >
                  <span className="truncate">{entry.Name}</span>
                </BossLink>
              </div>
            }
            mobileIdentity={
              <div className="flex items-center text-xs">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-secondary-wh40k">
                  <span className="flex-shrink-0">{getBossLevel(entry)}</span>
                  <BossLink
                    bossName={entry.Name ?? ''}
                    className="min-w-0 truncate text-yellow-400"
                  >
                    <span className="truncate">{entry.Name}</span>
                  </BossLink>
                </div>
                {showAllGuilds && (
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {entry.Guild && (
                      <span className="font-bold text-[var(--primary)]">
                        [{renderGuildTag(entry.Guild)}]
                      </span>
                    )}
                    <span className="text-[var(--text-primary)]">
                      <PlayerLink playerName={entry.displayName ?? ''}>
                        {entry.displayName}
                      </PlayerLink>
                    </span>
                  </div>
                )}
              </div>
            }
          />
        ))}
      </BattleLogTable>
    </div>
  )
}
