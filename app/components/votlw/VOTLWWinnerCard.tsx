'use client'

import { memo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { PlayerPoints } from '@tacticus/app-core/votlw.types'

interface VOTLWWinnerCardProps {
  veteran: PlayerPoints | null
}

function VOTLWWinnerCard({ veteran }: VOTLWWinnerCardProps) {
  if (!veteran) return null

  return (
    <div className="relative overflow-hidden bg-linear-to-br from-red-950 via-gray-900 to-black rounded-xl p-8 border-2 border-red-800 shadow-[0_0_50px_rgba(220,38,38,0.5)]">
      {/* Animated background effects */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-0 left-1/4 w-2 h-full bg-linear-to-b from-red-600 to-transparent animate-[drip_8s_ease-in-out_infinite]"></div>
        <div className="absolute top-0 right-1/3 w-1 h-full bg-linear-to-b from-red-700 to-transparent animate-[drip_10s_ease-in-out_infinite_2s]"></div>
        <div className="absolute top-0 left-2/3 w-1 h-full bg-linear-to-b from-red-800 to-transparent animate-[drip_12s_ease-in-out_infinite_4s]"></div>
      </div>

      {/* War imagery watermarks */}
      <div className="absolute top-4 right-4 text-7xl opacity-10 animate-pulse">
        💀
      </div>
      <div className="absolute bottom-4 left-4 text-6xl opacity-10 rotate-12">
        ⚔️
      </div>

      <div className="relative text-center">
        {/* Title with epic animation */}
        <h3 className="text-3xl font-black text-yellow-500 mb-4 flex items-center justify-center gap-3">
          <span>⚔️</span>
          <span className="tracking-wider animate-[glow_2s_ease-in-out_infinite]">
            VETERAN OF THE LONG WAR
          </span>
          <span>⚔️</span>
        </h3>

        {/* Champion Name with Epic Glow */}
        <p className="text-4xl font-black mt-4 mb-3">
          <PlayerLink playerName={veteran.displayName}>
            <span
              className="text-transparent bg-clip-text bg-linear-to-r from-red-400 via-yellow-500 to-red-400 animate-[shimmer_3s_linear_infinite]"
              style={{
                textShadow:
                  '0 0 20px rgba(220, 38, 38, 0.8), 0 0 40px rgba(234, 179, 8, 0.6), 0 0 60px rgba(220, 38, 38, 0.4)',
                WebkitTextStroke: '1px rgba(255, 255, 255, 0.3)'
              }}
            >
              {veteran.displayName}
            </span>
          </PlayerLink>
        </p>

        {/* Total Points with emphasis */}
        <div className="text-2xl text-yellow-400 font-bold mb-6 animate-pulse">
          ⭐ {veteran.totalPoints} TOTAL POINTS ⭐
        </div>

        {/* Complete Awards Summary */}
        <div className="bg-black/60 backdrop-blur-sm rounded-lg p-4 mb-4 border border-red-800/50">
          <h4 className="text-sm font-bold text-red-400 mb-3 uppercase tracking-wider">
            Battle Honors
          </h4>
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            {veteran.awards.goldMedals > 0 && (
              <div className="bg-yellow-900/30 px-3 py-1 rounded-full border border-yellow-600/50">
                <span className="flex items-center gap-1">
                  🥇 {veteran.awards.goldMedals} Gold Medal
                  {veteran.awards.goldMedals > 1 ? 's' : ''}
                </span>
              </div>
            )}
            {veteran.awards.silverMedals > 0 && (
              <div className="bg-gray-700/30 px-3 py-1 rounded-full border border-gray-500/50">
                <span className="flex items-center gap-1">
                  🥈 {veteran.awards.silverMedals} Silver Medal
                  {veteran.awards.silverMedals > 1 ? 's' : ''}
                </span>
              </div>
            )}
            {veteran.awards.bronzeMedals > 0 && (
              <div className="bg-orange-900/30 px-3 py-1 rounded-full border border-orange-700/50">
                <span className="flex items-center gap-1">
                  🥉 {veteran.awards.bronzeMedals} Bronze Medal
                  {veteran.awards.bronzeMedals > 1 ? 's' : ''}
                </span>
              </div>
            )}
            {veteran.awards.mostDamageAwards > 0 && (
              <div className="bg-red-900/30 px-3 py-1 rounded-full border border-red-700/50">
                <span className="flex items-center gap-1">
                  💥 {veteran.awards.mostDamageAwards} Most Damage
                </span>
              </div>
            )}
            {(veteran.awards.sideBoss1Wins || 0) +
              (veteran.awards.sideBoss2Wins || 0) >
              0 && (
              <div className="bg-purple-900/30 px-3 py-1 rounded-full border border-purple-700/50">
                <span className="flex items-center gap-1">
                  👹{' '}
                  {(veteran.awards.sideBoss1Wins || 0) +
                    (veteran.awards.sideBoss2Wins || 0)}{' '}
                  Side Boss Victor
                  {(veteran.awards.sideBoss1Wins || 0) +
                    (veteran.awards.sideBoss2Wins || 0) >
                  1
                    ? 'ies'
                    : 'y'}
                </span>
              </div>
            )}
            {veteran.awards.biggestHitAwards > 0 && (
              <div className="bg-blue-900/30 px-3 py-1 rounded-full border border-blue-700/50">
                <span className="flex items-center gap-1">
                  🎯 {veteran.awards.biggestHitAwards} Biggest Hit
                  {veteran.awards.biggestHitAwards > 1 ? 's' : ''}
                </span>
              </div>
            )}
            {veteran.awards.topKiller && (
              <div className="bg-green-900/30 px-3 py-1 rounded-full border border-green-600/50 animate-pulse">
                <span className="text-green-400 flex items-center gap-1">
                  🔪 TOP KILLER
                </span>
              </div>
            )}
            {veteran.awards.bestBomber && (
              <div className="bg-orange-900/30 px-3 py-1 rounded-full border border-orange-600/50">
                <span className="text-orange-400 flex items-center gap-1">
                  💣 BOMB MASTER
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Combat Statistics */}
        <div className="flex justify-center gap-8 text-base">
          <div className="text-red-200">
            <span className="text-red-400 text-sm uppercase tracking-wider">
              Average Damage
            </span>
            <div className="text-2xl font-bold text-yellow-400">
              {formatNumber(veteran.avgDamagePerHit)}
            </div>
          </div>
          <div className="text-red-200">
            <span className="text-red-400 text-sm uppercase tracking-wider">
              Tokens Deployed
            </span>
            <div className="text-2xl font-bold text-yellow-400">
              {veteran.tokenCount}
            </div>
          </div>
        </div>

        {/* Epic bottom effect */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-linear-to-r from-transparent via-red-500 to-transparent opacity-80 animate-[plasmaFlow_3s_ease-in-out_infinite]"></div>
      </div>
    </div>
  )
}

export default memo(VOTLWWinnerCard)
