'use client'

import { useMemo, useState } from 'react'
import { normalizeRarity, type Rarity } from '@tacticus/app-core/rarity-utils'

import { useMemoryMonitor, usePerformance } from '@/app/hooks/usePerformance'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { SinglePassStageFilter } from '@/app/components/filters/SinglePassStageFilter'
import { BossLeaderboardResults } from './boss-leaderboards/BossLeaderboardResults'
import { BossLeaderboardsCalculationsFAQ } from './boss-leaderboards/BossLeaderboardsCalculationsFAQ'
import { BossSelectionControls } from './boss-leaderboards/BossSelectionControls'
import { useBossLeaderboardData } from './boss-leaderboards/useBossLeaderboardData'
import {
  findSelectedBoss,
  getLevelDisplay,
  groupBossesByLevel,
  sortBossLevels,
  type RankBy
} from './boss-leaderboards/model'

interface BossLeaderboardsProps {
  initialSeason: string
  userGuild: string
}

export default function BossLeaderboards({
  initialSeason,
  userGuild
}: BossLeaderboardsProps) {
  usePerformance('BossLeaderboards', {
    threshold: 50,
    trackRerenders: true
  })
  useMemoryMonitor('BossLeaderboards', 75)
  const [includeSinglePass, setIncludeSinglePass] = useState(false)
  const [rankBy, setRankBy] = useState<RankBy>('max')
  const {
    context,
    selectedBossId,
    setSelectedBossId,
    availableBosses,
    singlePassBosses,
    availableRarities,
    defaultRarities,
    selectedRarities,
    setSelectedRarities,
    resetSelectedRarities,
    leaderboardData,
    avgLeaderboardData,
    heroMappings,
    guildLabels,
    loading
  } = useBossLeaderboardData(initialSeason)

  const activeRarities =
    selectedRarities.length > 0 ? selectedRarities : defaultRarities
  const loopVisibleBosses =
    includeSinglePass && singlePassBosses.length > 0
      ? [...availableBosses, ...singlePassBosses]
      : availableBosses
  const singlePassStages = sortBossLevels(groupBossesByLevel(singlePassBosses))
    .slice()
    .reverse()
  const filteredBosses = loopVisibleBosses.filter((boss) => {
    if (activeRarities.length === 0) return true
    const rarity = normalizeRarity(boss.rarity)
    return Boolean(rarity && activeRarities.includes(rarity))
  })
  const bossesByLevel = groupBossesByLevel(filteredBosses)
  const levels = sortBossLevels(bossesByLevel)
  const selectedBoss = findSelectedBoss(loopVisibleBosses, selectedBossId)
  const activeLevel = selectedBoss
    ? getLevelDisplay(selectedBoss.set, selectedBoss.rarity)
    : (levels[0] ?? '')
  const rarityCounts = useMemo(() => {
    const counts: Partial<Record<Rarity, number>> = {}
    for (const boss of availableBosses) {
      const rarity = normalizeRarity(boss.rarity)
      if (rarity) counts[rarity] = (counts[rarity] ?? 0) + 1
    }
    return counts
  }, [availableBosses])
  const displayedData = rankBy === 'avg' ? avgLeaderboardData : leaderboardData
  const renderGuild = (guild: string) =>
    guildLabels[guild] ?? formatGuildDisplayLabel(null, guild)

  return (
    <div className="space-y-6">
      <BossSelectionControls
        contextLabel={
          context.clusterCode
            ? `Cluster: ${context.clusterCode}`
            : `Guild: ${context.guildCode ? renderGuild(context.guildCode) : 'All'}`
        }
        season={initialSeason}
        bossCount={availableBosses.length}
        availableRarities={availableRarities}
        selectedRarities={selectedRarities}
        defaultRarities={defaultRarities}
        rarityCounts={rarityCounts}
        onRaritiesChange={setSelectedRarities}
        onRaritiesReset={resetSelectedRarities}
        levels={levels}
        activeLevel={activeLevel}
        bossesByLevel={bossesByLevel}
        selectedBossId={selectedBossId}
        onBossSelect={setSelectedBossId}
      />

      <SinglePassStageFilter
        singlePassStages={singlePassStages}
        included={includeSinglePass}
        onChange={setIncludeSinglePass}
        className="-mt-4"
      />

      <BossLeaderboardResults
        activeLevel={activeLevel}
        selectedBoss={selectedBoss}
        rankBy={rankBy}
        onRankByChange={setRankBy}
        loading={loading}
        entries={displayedData}
        heroMappings={heroMappings}
        guildLabels={guildLabels}
        userGuild={userGuild}
      />

      <div className="mt-6 sm:mt-8 bg-(--card-bg) border border-(--card-border) rounded-lg p-4 sm:p-6">
        <BossLeaderboardsCalculationsFAQ />
      </div>
    </div>
  )
}
