'use client'

import { memo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { PlayerPoints } from '@tacticus/app-core/votlw.types'

interface VOTLWRunnerUpCardProps {
  runnerUp: PlayerPoints | null
}

function VOTLWRunnerUpCard({ runnerUp }: VOTLWRunnerUpCardProps) {
  if (!runnerUp) return null

  return (
    <div className="relative overflow-hidden bg-linear-to-br from-gray-800 via-gray-900 to-black rounded-lg p-6 border border-(--card-border)">
      <div className="absolute top-3 right-3 text-5xl opacity-10">🛡️</div>

      <div className="relative text-center">
        <h3 className="text-2xl font-bold text-primary-wh40k mb-3 tracking-wide">
          ⚔️ RUNNER UP ⚔️
        </h3>

        <p className="text-3xl font-bold mt-3 mb-3">
          <PlayerLink playerName={runnerUp.displayName}>
            <span
              className="text-gray-100"
              style={{ textShadow: '0 0 10px rgba(156, 163, 175, 0.5)' }}
            >
              {runnerUp.displayName}
            </span>
          </PlayerLink>
        </p>

        <p className="text-xl text-primary-wh40k font-semibold mb-4">
          {runnerUp.totalPoints} total points
        </p>

        {/* Runner Up Awards */}
        <div className="bg-black/40 rounded-lg p-3 mb-4">
          <div className="flex flex-wrap justify-center gap-2 text-sm">
            {runnerUp.awards.goldMedals > 0 && (
              <span className="px-2 py-1 bg-yellow-900/20 rounded-sm">
                🥇 {runnerUp.awards.goldMedals} Gold
              </span>
            )}
            {runnerUp.awards.silverMedals > 0 && (
              <span className="px-2 py-1 bg-gray-700/20 rounded-sm">
                🥈 {runnerUp.awards.silverMedals} Silver
              </span>
            )}
            {runnerUp.awards.bronzeMedals > 0 && (
              <span className="px-2 py-1 bg-orange-900/20 rounded-sm">
                🥉 {runnerUp.awards.bronzeMedals} Bronze
              </span>
            )}
            {runnerUp.awards.mostDamageAwards > 0 && (
              <span className="px-2 py-1 bg-red-900/20 rounded-sm">
                💥 {runnerUp.awards.mostDamageAwards} Most Dmg
              </span>
            )}
            {(runnerUp.awards.sideBoss1Wins || 0) +
              (runnerUp.awards.sideBoss2Wins || 0) >
              0 && (
              <span className="px-2 py-1 bg-purple-900/20 rounded-sm">
                👹{' '}
                {(runnerUp.awards.sideBoss1Wins || 0) +
                  (runnerUp.awards.sideBoss2Wins || 0)}{' '}
                Side Boss
              </span>
            )}
            {runnerUp.awards.biggestHitAwards > 0 && (
              <span className="px-2 py-1 bg-blue-900/20 rounded-sm">
                🎯 {runnerUp.awards.biggestHitAwards} Big Hit
              </span>
            )}
            {runnerUp.awards.topKiller && (
              <span className="text-green-400 px-2 py-1 bg-green-900/20 rounded-sm">
                🔪 Top Killer
              </span>
            )}
            {runnerUp.awards.bestBomber && (
              <span className="text-orange-400 px-2 py-1 bg-orange-900/20 rounded-sm">
                💣 Best Bomber
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-center gap-6 text-sm">
          <div className="text-secondary-wh40k">
            <span className="text-xs uppercase">Avg Damage</span>
            <div className="font-bold text-primary-wh40k">
              {formatNumber(runnerUp.avgDamagePerHit)}
            </div>
          </div>
          <div className="text-secondary-wh40k">
            <span className="text-xs uppercase">Tokens</span>
            <div className="font-bold text-primary-wh40k">
              {runnerUp.tokenCount}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(VOTLWRunnerUpCard)
