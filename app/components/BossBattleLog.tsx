'use client'

import { useEffect, useRef, useState } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
import { parseLevelString } from '@/app/lib/catalogs/rarity-set'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { BossLink } from '@/app/components/ui/BossLink'
import type { BattleLogEntry } from '@/app/lib/utils/battle-log-helpers'
import {
  useBattleLogData,
  type QueryModifier
} from '@/app/lib/hooks/useBattleLogData'
import {
  BattleLogControls,
  BattleLogEntryRow,
  BattleLogTable
} from '@/app/components/ui/BattleLogTable'

const logger = createComponentLogger('components.BossBattleLog')

type BossBattleType = 'all' | 'battles' | 'bosses' | 'primes' | 'bombs'

const BOSS_BATTLE_FILTERS = [
  {
    value: 'all',
    label: 'All',
    activeClassName: 'bg-accent-wh40k text-(--bg-primary)'
  },
  {
    value: 'battles',
    label: '\u2694\uFE0F Battles',
    activeClassName: 'bg-primary-wh40k text-black'
  },
  {
    value: 'bosses',
    label: 'Bosses',
    activeClassName: 'bg-primary-wh40k text-black'
  },
  {
    value: 'primes',
    label: 'Primes',
    activeClassName: 'bg-accent-wh40k text-black'
  },
  {
    value: 'bombs',
    label: '\uD83D\uDCA3',
    activeClassName: 'bg-red-600 text-primary-wh40k'
  }
] as const satisfies readonly {
  value: BossBattleType
  label: string
  activeClassName: string
}[]

function useGuildClusterContext(selectedGuild: string) {
  const [clusterCode, setClusterCode] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false
    const update = async () => {
      if (!selectedGuild) {
        if (!isCancelled) setClusterCode(null)
        return
      }
      try {
        // Intentionally uncached; see BattleLog's bundle/TTL note.
        const { dbClient } = await import('@/app/lib/db/client')
        const { data: guildConfig } = await dbClient()
          .from('guild_config')
          .select('cluster_code')
          .eq('guild_code', selectedGuild)
          .single()
        if (!isCancelled) setClusterCode(guildConfig?.cluster_code || null)
      } catch (error) {
        if (!isCancelled) {
          logger.error({ error }, 'Error getting guild cluster context')
          setClusterCode(null)
        }
      }
    }
    void update()
    return () => {
      isCancelled = true
    }
  }, [selectedGuild])

  return clusterCode
}

interface BossBattleLogProps {
  selectedGuild: string
  selectedSeason: string
  level: string
  bossName: string
}

function renderBossLink(entry: BattleLogEntry, portrait: boolean) {
  const isPrime = (entry.encounterId ?? 0) > 0
  const label = entry.Name || (isPrime ? `Prime #${entry.encounterId}` : 'Boss')
  if (!entry.Name && !isPrime) {
    return <span className="text-secondary-wh40k">Boss</span>
  }
  return (
    <BossLink
      bossName={label}
      className={isPrime ? 'text-(--accent)' : 'text-(--primary)'}
      showPortrait={portrait}
      portraitSize="small"
      portraitVariant="icon"
    >
      {label}
    </BossLink>
  )
}

export default function BossBattleLog({
  selectedGuild,
  selectedSeason,
  level,
  bossName
}: BossBattleLogProps) {
  const hasMounted = useHasMounted()
  const clusterCode = useGuildClusterContext(selectedGuild)
  const [showType, setShowType] = useState<BossBattleType>('all')
  const [page, setPage] = useState(0)
  const filterValuesRef = useRef('')
  const [pageSize, setPageSize] = useState(25)

  const filterKey = `${selectedGuild}|${selectedSeason}|${level}|${showType}`
  useEffect(() => {
    if (filterValuesRef.current && filterValuesRef.current !== filterKey) {
      setPage(0)
    }
    filterValuesRef.current = filterKey
  }, [filterKey])

  const levelInfo = parseLevelString(level)
  const buildFilters: QueryModifier = (query) => {
    query = query.eq('Guild', selectedGuild).eq('Season', selectedSeason)
    if (levelInfo) {
      query = query.eq('set', levelInfo.set).eq('rarity', levelInfo.rarity)
    }
    if (clusterCode) query = query.eq('cluster_code', clusterCode)
    if (showType === 'battles') query = query.eq('damageType', 'Battle')
    else if (showType === 'bosses') query = query.eq('encounterId', 0)
    else if (showType === 'primes') query = query.gt('encounterId', 0)
    else if (showType === 'bombs') query = query.eq('damageType', 'Bomb')
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
    selectColumns:
      'id, displayName, Name, damageDealt, damageType, tier, set, loopIndex, completedOn, remainingHp, maxHp, heroDetails, machineOfWarDetails, encounterId, rarity',
    buildFilters,
    enabled: !!(selectedGuild && selectedSeason && level && levelInfo),
    deps: [showType, clusterCode, level]
  })

  const entriesByLoop = entries.reduce<Record<number, BattleLogEntry[]>>(
    (groups, entry) => {
      const loop = entry.loopIndex || 0
      ;(groups[loop] ??= []).push(entry)
      return groups
    },
    {}
  )
  const loops = Object.keys(entriesByLoop)
    .map(Number)
    .sort((a, b) => b - a)

  return (
    <div className="card-wh40k p-3 sm:p-4 md:p-6">
      <div className="mb-3 sm:mb-4">
        <h3 className="heading-wh40k mb-2 sm:mb-3">
          Battle History - {level} {bossName || ''}
        </h3>
        <BattleLogControls
          options={BOSS_BATTLE_FILTERS}
          value={showType}
          onChange={setShowType}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          pageSizes={[25, 50, 100]}
        />
      </div>

      <BattleLogTable
        loading={loading}
        isEmpty={entries.length === 0}
        loadingMessage="Loading battle history..."
        emptyTitle="No battle records found"
        emptyDescription=""
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        totalCount={totalCount}
      >
        <div className="space-y-6 pr-2">
          {loops.map((loop) => {
            const loopEntries = entriesByLoop[loop] ?? []
            return (
              <section key={loop} className="space-y-2">
                <h4 className="sticky top-0 z-10 bg-(--bg-primary) py-2 text-sm font-bold text-accent-wh40k">
                  {loopEntries.length} entries
                </h4>
                {loopEntries.map((entry) => (
                  <BattleLogEntryRow
                    key={entry.id}
                    entry={entry}
                    heroMappings={heroMappings}
                    guildPerformancePctMap={guildPerformancePctMap}
                    clusterPerformancePctMap={clusterPerformancePctMap}
                    clusterCode={clusterCode}
                    hasMounted={hasMounted}
                    desktopGridClassName="grid-cols-[32px_110px_140px_130px_1fr_90px_40px_40px_80px_auto]"
                    desktopPrimary={
                      <div className="truncate">
                        <span className="font-medium text-primary-wh40k">
                          <PlayerLink playerName={entry.displayName ?? ''}>
                            {entry.displayName}
                          </PlayerLink>
                        </span>
                      </div>
                    }
                    desktopSecondary={
                      <div className="truncate text-xs">
                        <span className="flex items-center gap-1">
                          vs {renderBossLink(entry, true)}
                        </span>
                      </div>
                    }
                    mobileIdentity={
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium text-primary-wh40k">
                          <PlayerLink playerName={entry.displayName ?? ''}>
                            {entry.displayName}
                          </PlayerLink>
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-secondary-wh40k">vs</span>
                          {renderBossLink(entry, false)}
                        </div>
                      </div>
                    }
                  />
                ))}
              </section>
            )
          })}
        </div>
      </BattleLogTable>
    </div>
  )
}
