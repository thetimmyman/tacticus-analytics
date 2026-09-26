'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { BossAnalysis, BossComparisonStates } from '../_types'
import { PARTICLE_IDS_20 } from '../_constants'
import { getPseudoRandom } from '../_utils/pseudo-random'
import { BossAnalysisPanel } from './BossAnalysisPanel'

const LEVEL_ORDER = ['M5', 'M4', 'M3', 'M2', 'M1', 'L5', 'L4', 'L3', 'L2', 'L1']

export interface BossLevelsSectionProps {
  bossAnalyses: BossAnalysis[]
  setBossAnalyses: Dispatch<SetStateAction<BossAnalysis[]>>
  levelFilter: string
  selectedMetaTeams: Set<string>
  bossComparisonStates: BossComparisonStates
  setBossComparisonStates: Dispatch<SetStateAction<BossComparisonStates>>
  onRetry?: () => void
}

export function BossLevelsSection({
  bossAnalyses,
  setBossAnalyses,
  levelFilter,
  selectedMetaTeams,
  bossComparisonStates,
  setBossComparisonStates,
  onRetry
}: BossLevelsSectionProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-[var(--text-primary)]">
        Detailed Team Rankings by Boss
      </h2>

      {LEVEL_ORDER.filter(
        (level) => levelFilter === 'all' || level === levelFilter
      ).map((level) => {
        const levelAnalyses = bossAnalyses.filter(
          (a) => a.levelString === level
        )
        if (levelAnalyses.length === 0) return null

        const mainBoss = levelAnalyses.find((a) => a.bossType === 'main')
        const sideBossLeft = levelAnalyses.find(
          (a) => a.bossType === 'side-left'
        )
        const sideBossRight = levelAnalyses.find(
          (a) => a.bossType === 'side-right'
        )
        const isMythic = level.startsWith('M')

        return (
          <div
            key={level}
            className={`${isMythic ? 'mythic-section' : 'diamond-section'} rounded-lg p-6 relative`}
          >
            {isMythic
              ? PARTICLE_IDS_20.map((particleId, idx) => {
                  const seed = level.charCodeAt(0) + level.charCodeAt(1) + idx
                  return (
                    <div
                      key={`boss-mythic-particle-${level}-${particleId}`}
                      className="mythic-particle"
                      style={{
                        left: `${getPseudoRandom(seed, 100)}%`,
                        animationDelay: `${getPseudoRandom(seed + 1, 7)}s`,
                        width: `${3 + getPseudoRandom(seed + 2, 3)}px`,
                        height: `${3 + getPseudoRandom(seed + 3, 3)}px`,
                        background: `radial-gradient(circle, rgba(255, ${140 + getPseudoRandom(seed + 4, 55)}, 0, 0.8) 0%, transparent 70%)`
                      }}
                    />
                  )
                })
              : PARTICLE_IDS_20.map((particleId, idx) => {
                  const seed = level.charCodeAt(0) + level.charCodeAt(1) + idx
                  return (
                    <div
                      key={`boss-diamond-particle-${level}-${particleId}`}
                      className="diamond-particle"
                      style={{
                        left: `${getPseudoRandom(seed, 100)}%`,
                        animationDelay: `${getPseudoRandom(seed + 1, 8)}s`,
                        width: `${2 + getPseudoRandom(seed + 2, 2)}px`,
                        height: `${2 + getPseudoRandom(seed + 3, 2)}px`,
                        background: `radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%)`
                      }}
                    />
                  )
                })}

            <h3
              className={`text-lg font-semibold ${isMythic ? 'mythic-title' : 'diamond-title'} pb-2 relative z-10`}
            >
              {level} Boss Encounters
            </h3>

            <div className="relative z-10 space-y-4">
              {mainBoss && (
                <BossAnalysisPanel
                  analysis={mainBoss}
                  bossLabel="Main Boss"
                  selectedMetaTeams={selectedMetaTeams}
                  bossComparisonStates={bossComparisonStates}
                  setBossComparisonStates={setBossComparisonStates}
                  setBossAnalyses={setBossAnalyses}
                  onRetry={onRetry}
                />
              )}
              {sideBossLeft && (
                <BossAnalysisPanel
                  analysis={sideBossLeft}
                  bossLabel="Side Boss 0 (Left)"
                  selectedMetaTeams={selectedMetaTeams}
                  bossComparisonStates={bossComparisonStates}
                  setBossComparisonStates={setBossComparisonStates}
                  setBossAnalyses={setBossAnalyses}
                  onRetry={onRetry}
                />
              )}
              {sideBossRight && (
                <BossAnalysisPanel
                  analysis={sideBossRight}
                  bossLabel="Side Boss 1 (Right)"
                  selectedMetaTeams={selectedMetaTeams}
                  bossComparisonStates={bossComparisonStates}
                  setBossComparisonStates={setBossComparisonStates}
                  setBossAnalyses={setBossAnalyses}
                  onRetry={onRetry}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
