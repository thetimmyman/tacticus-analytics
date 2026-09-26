'use client'

import { memo, useMemo, useState } from 'react'
import { SinglePassStageFilter } from '@/app/components/filters/SinglePassStageFilter'
import { BossLevelsSection } from './_components/BossLevelsSection'
import { FilterPanel } from './_components/FilterPanel'
import { LoadingProgressBar } from './_components/LoadingProgressBar'
import { MetaAnalysisCalculationsFAQ } from './_components/MetaAnalysisFAQ'
import { RecommendedTeamsPanel } from './_components/RecommendedTeamsPanel'
import { useMetaAnalysisData } from './_hooks/useMetaAnalysisData'
import { useMetaFilterState } from './_hooks/useMetaFilterState'
import type { MetaAnalysisClientProps } from './_types'

function MetaAnalysisClient({ initialSeason }: MetaAnalysisClientProps) {
  const filter = useMetaFilterState(initialSeason)

  const data = useMetaAnalysisData({
    season: filter.season,
    selectedRarities: filter.selectedRarities,
    setAvailableMetaTeams: filter.setAvailableMetaTeams,
    setAvailableLevels: filter.setAvailableLevels
  })

  const [includeSinglePass, setIncludeSinglePass] = useState(false)

  /** Out-of-window stages stay available but hidden until the pill is on, unless deep-linked. */
  const hiddenStages = useMemo(() => {
    if (includeSinglePass) return new Set<string>()
    return new Set(
      data.singlePassStages.filter((stage) => stage !== filter.levelFilter)
    )
  }, [data.singlePassStages, includeSinglePass, filter.levelFilter])

  const visibleLevels = useMemo(
    () => filter.availableLevels.filter((level) => !hiddenStages.has(level)),
    [filter.availableLevels, hiddenStages]
  )

  const visibleBossAnalyses = useMemo(
    () => data.bossAnalyses.filter((a) => !hiddenStages.has(a.levelString)),
    [data.bossAnalyses, hiddenStages]
  )

  if (data.error) {
    return (
      <div className="card-wh40k p-8">
        <div className="text-[var(--accent)] text-center">{data.error}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <FilterPanel
        scope={data.scope}
        selectedRarities={filter.selectedRarities}
        setSelectedRarities={filter.setSelectedRarities}
        availableLevels={visibleLevels}
        levelFilter={filter.levelFilter}
        setLevelFilter={filter.setLevelFilter}
        availableMetaTeams={filter.availableMetaTeams}
        selectedMetaTeams={filter.selectedMetaTeams}
        setSelectedMetaTeams={filter.setSelectedMetaTeams}
        recommendedLoading={data.recommendedLoading}
        onRefresh={data.fetchAllData}
      />

      <SinglePassStageFilter
        singlePassStages={data.singlePassStages}
        included={includeSinglePass}
        onChange={setIncludeSinglePass}
      />

      {data.bossDataLoading && (
        <LoadingProgressBar
          current={data.loadingProgress.current}
          total={data.loadingProgress.total}
        />
      )}

      <RecommendedTeamsPanel
        recommendedTeams={data.recommendedTeams}
        recommendedLoading={data.recommendedLoading}
        levelFilter={filter.levelFilter}
        selectedMetaTeams={filter.selectedMetaTeams}
        source={data.recommendedSource}
        onRetry={data.fetchAllData}
      />

      <BossLevelsSection
        bossAnalyses={visibleBossAnalyses}
        setBossAnalyses={data.setBossAnalyses}
        levelFilter={filter.levelFilter}
        selectedMetaTeams={filter.selectedMetaTeams}
        bossComparisonStates={filter.bossComparisonStates}
        setBossComparisonStates={filter.setBossComparisonStates}
        onRetry={data.fetchAllData}
      />

      <MetaAnalysisCalculationsFAQ />
    </div>
  )
}

export default memo(MetaAnalysisClient)
