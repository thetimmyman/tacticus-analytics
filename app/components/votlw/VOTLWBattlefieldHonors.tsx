'use client'

import { memo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import {
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import type { SeasonResults } from '@tacticus/app-core/votlw.types'

interface VOTLWBattlefieldHonorsProps {
  seasonAwards: SeasonResults | null
}

function VOTLWBattlefieldHonors({ seasonAwards }: VOTLWBattlefieldHonorsProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border-2 border-amber-900/50 bg-linear-to-br from-black via-amber-950/20 to-black p-6">
      {/* Battle scarred background */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,0,0,0.1)_10px,rgba(255,0,0,0.1)_20px)]" />
      </div>

      <div className="relative z-10">
        <h3 className="text-2xl font-black mb-4 uppercase tracking-wider text-center">
          <span
            className="bg-linear-to-r from-amber-500 via-yellow-500 to-amber-500 bg-clip-text text-transparent animate-[shimmer_3s_ease-in-out_infinite]"
            style={{ backgroundSize: '200% auto' }}
          >
            Battlefield Honors
          </span>
          <div className="text-xs text-amber-400/60 mt-1">
            Recognized for Valor in Combat
          </div>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Worst Bomb */}
          <div className="relative group bg-linear-to-br from-brown-600/20 to-amber-700/20 rounded-lg p-4 border border-amber-800/50 hover:border-amber-600 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]">
            <div className="absolute -top-3 -left-3 text-3xl transform -rotate-12 group-hover:rotate-0 transition-transform duration-300">
              💩
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-2 text-right">
              Melta Malfunction
            </div>
            <div className="font-bold text-lg text-amber-100 group-hover:text-white transition-colors">
              <PlayerLink playerName={seasonAwards?.worstBomb?.player || ''}>
                {seasonAwards?.worstBomb?.player || 'TBD'}
              </PlayerLink>
            </div>
            <div className="mt-3 pt-3 border-t border-amber-900/30">
              <div className="text-2xl font-black bg-linear-to-r from-yellow-400 to-amber-400 bg-clip-text text-transparent">
                {formatNumber(seasonAwards?.worstBomb?.value || 0)}
              </div>
              <div className="text-xs text-amber-400/60">
                Weakest bomb damage
              </div>
            </div>
          </div>

          {/* Almost Had Him */}
          <div className="relative group bg-linear-to-br from-indigo-600/20 to-purple-600/20 rounded-lg p-4 border border-amber-800/50 hover:border-amber-600 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]">
            <div className="absolute -top-3 -left-3 text-3xl transform -rotate-12 group-hover:rotate-0 transition-transform duration-300">
              😭
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-2 text-right">
              So Close...
            </div>
            <div className="font-bold text-lg text-amber-100 group-hover:text-white transition-colors">
              <PlayerLink playerName={seasonAwards?.almostHadHim?.player || ''}>
                {seasonAwards?.almostHadHim?.player || 'TBD'}
              </PlayerLink>
            </div>
            <div className="text-xs text-amber-400/60 mt-1">
              {seasonAwards?.almostHadHim?.boss || ''}
            </div>
            <div className="mt-3 pt-3 border-t border-amber-900/30">
              <div className="text-2xl font-black bg-linear-to-r from-yellow-400 to-amber-400 bg-clip-text text-transparent">
                {formatNumber(seasonAwards?.almostHadHim?.hpLeft || 0)} HP
              </div>
              <div className="text-xs text-amber-400/60">HP remaining</div>
            </div>
          </div>

          {/* Most Improved */}
          <div className="relative group bg-linear-to-br from-green-600/20 to-emerald-600/20 rounded-lg p-4 border border-amber-800/50 hover:border-amber-600 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]">
            <div className="absolute -top-3 -left-3 text-3xl transform -rotate-12 group-hover:rotate-0 transition-transform duration-300">
              📈
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-2 text-right">
              Rising Star
            </div>
            <div className="font-bold text-lg text-amber-100 group-hover:text-white transition-colors">
              <PlayerLink playerName={seasonAwards?.mostImproved?.player || ''}>
                {seasonAwards?.mostImproved?.player || 'TBD'}
              </PlayerLink>
            </div>
            <div className="mt-3 pt-3 border-t border-amber-900/30">
              <div className="text-2xl font-black bg-linear-to-r from-yellow-400 to-amber-400 bg-clip-text text-transparent">
                {(seasonAwards?.mostImproved?.improvementPct || 0) > 0
                  ? formatPercentageDiff(
                      seasonAwards?.mostImproved?.improvementPct || 0
                    )
                  : 'TBD'}
              </div>
              <div className="text-xs text-amber-400/60">
                vs Previous Season
              </div>
            </div>
          </div>

          {/* Lightning Strike - First Token */}
          <div className="relative group bg-linear-to-br from-blue-600/20 to-cyan-600/20 rounded-lg p-4 border border-amber-800/50 hover:border-amber-600 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]">
            <div className="absolute -top-3 -left-3 text-3xl transform -rotate-12 group-hover:rotate-0 transition-transform duration-300">
              ⚡
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-2 text-right">
              Lightning Strike
            </div>
            <div className="font-bold text-lg text-amber-100 group-hover:text-white transition-colors">
              <PlayerLink playerName={seasonAwards?.firstToken?.player || ''}>
                {seasonAwards?.firstToken?.player || 'TBD'}
              </PlayerLink>
            </div>
            <div className="mt-3 pt-3 border-t border-amber-900/30">
              <div className="text-xs text-amber-400/60 font-semibold">
                First Token Used
              </div>
              <div className="text-xs text-amber-400/40 mt-1">
                Swift & Decisive
              </div>
            </div>
          </div>

          {/* Iron Resolve - Last Token */}
          <div className="relative group bg-linear-to-br from-purple-600/20 to-pink-600/20 rounded-lg p-4 border border-amber-800/50 hover:border-amber-600 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]">
            <div className="absolute -top-3 -left-3 text-3xl transform -rotate-12 group-hover:rotate-0 transition-transform duration-300">
              🔨
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-2 text-right">
              Iron Resolve
            </div>
            <div className="font-bold text-lg text-amber-100 group-hover:text-white transition-colors">
              <PlayerLink playerName={seasonAwards?.lastToken?.player || ''}>
                {seasonAwards?.lastToken?.player || 'TBD'}
              </PlayerLink>
            </div>
            <div className="mt-3 pt-3 border-t border-amber-900/30">
              <div className="text-xs text-amber-400/60 font-semibold">
                Last Token Used
              </div>
              <div className="text-xs text-amber-400/40 mt-1">
                Methodical & Thorough
              </div>
            </div>
          </div>

          {/* Most Efficient */}
          <div className="relative group bg-linear-to-br from-yellow-600/20 to-orange-600/20 rounded-lg p-4 border border-amber-800/50 hover:border-amber-600 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]">
            <div className="absolute -top-3 -left-3 text-3xl transform -rotate-12 group-hover:rotate-0 transition-transform duration-300">
              ⚡
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400/80 mb-2 text-right">
              Machine Spirit
            </div>
            <div className="font-bold text-lg text-amber-100 group-hover:text-white transition-colors">
              <PlayerLink
                playerName={seasonAwards?.tokenEfficiency?.player || ''}
              >
                {seasonAwards?.tokenEfficiency?.player || 'TBD'}
              </PlayerLink>
            </div>
            <div className="mt-3 pt-3 border-t border-amber-900/30">
              <div className="text-2xl font-black bg-linear-to-r from-yellow-400 to-amber-400 bg-clip-text text-transparent">
                {formatNumber(seasonAwards?.tokenEfficiency?.ratio || 0)}
              </div>
              <div className="text-xs text-amber-400/60">Damage per token</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(VOTLWBattlefieldHonors)
