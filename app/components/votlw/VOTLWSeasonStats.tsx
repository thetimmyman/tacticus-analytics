'use client'

import { memo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { SeasonResults } from '@tacticus/app-core/votlw.types'

interface VOTLWSeasonStatsProps {
  seasonAwards: SeasonResults | null
}

function VOTLWSeasonStats({ seasonAwards }: VOTLWSeasonStatsProps) {
  return (
    <>
      {/* Season Elite Awards - Death Dealers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TOP KILLER - DEATH INCARNATE */}
        <div className="relative overflow-hidden bg-linear-to-br from-black via-red-950/40 to-black rounded-xl p-6 border-2 border-red-600 shadow-[0_0_40px_rgba(220,38,38,0.6)]">
          {/* Blood splatter background */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 left-1/4 w-3 h-full bg-linear-to-b from-red-600 to-transparent animate-[drip_6s_ease-in-out_infinite]"></div>
            <div className="absolute top-0 right-1/3 w-2 h-full bg-linear-to-b from-red-700 to-transparent animate-[drip_8s_ease-in-out_infinite_2s]"></div>
          </div>

          {/* Skull watermark */}
          <div className="absolute top-4 right-4 text-6xl opacity-20 animate-pulse">
            💀
          </div>

          <div className="relative text-center">
            <h4 className="text-xl font-black text-red-500 mb-2 tracking-wider animate-[glow_3s_ease-in-out_infinite]">
              🔪 DEATH DEALER 🔪
            </h4>
            <div className="text-xs text-red-400/80 uppercase tracking-widest mb-3">
              Top Killer of the Season
            </div>

            <div className="bg-black/60 backdrop-blur-sm rounded-lg p-4 border border-red-800/50">
              <div className="text-4xl font-black text-red-400 mb-2 animate-pulse">
                {seasonAwards?.topKiller?.value || 0}
              </div>
              <div className="text-xs text-red-300/80 uppercase tracking-wider mb-3">
                Boss Executions
              </div>

              <div className="text-2xl font-bold">
                <PlayerLink playerName={seasonAwards?.topKiller?.player || ''}>
                  <span
                    className="text-transparent bg-clip-text bg-linear-to-r from-red-400 via-white to-red-400 animate-[shimmer_3s_linear_infinite]"
                    style={{
                      backgroundSize: '200% auto',
                      textShadow: '0 0 20px rgba(220, 38, 38, 0.8)'
                    }}
                  >
                    {seasonAwards?.topKiller?.player || 'AWAITING CHAMPION'}
                  </span>
                </PlayerLink>
              </div>
            </div>

            <div className="mt-4 text-xs text-red-400/60 italic">
              &quot;In the grim darkness, only death is certain&quot;
            </div>

            {/* Bottom blood effect */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-linear-to-r from-transparent via-red-600 to-transparent opacity-80 animate-[plasmaFlow_3s_ease-in-out_infinite]"></div>
          </div>
        </div>

        {/* BEST BOMBER - DEMOLITION EXPERT */}
        <div className="relative overflow-hidden bg-linear-to-br from-black via-orange-950/40 to-black rounded-xl p-6 border-2 border-orange-600 shadow-[0_0_40px_rgba(234,88,12,0.6)]">
          {/* Explosion particles background */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-orange-500 rounded-full animate-[float_4s_ease-in-out_infinite]"></div>
            <div className="absolute top-1/2 right-1/3 w-3 h-3 bg-yellow-500 rounded-full animate-[float_5s_ease-in-out_infinite_1s]"></div>
            <div className="absolute bottom-1/4 left-1/2 w-2 h-2 bg-red-500 rounded-full animate-[float_3s_ease-in-out_infinite_2s]"></div>
          </div>

          {/* Explosion watermark */}
          <div className="absolute top-4 right-4 text-6xl opacity-20 animate-[bounce_2s_ease-in-out_infinite]">
            💥
          </div>

          <div className="relative text-center">
            <h4 className="text-xl font-black text-orange-500 mb-2 tracking-wider animate-[glow_3s_ease-in-out_infinite]">
              💣 DEMOLITION EXPERT 💣
            </h4>
            <div className="text-xs text-orange-400/80 uppercase tracking-widest mb-3">
              Maximum Explosive Force
            </div>

            <div className="bg-black/60 backdrop-blur-sm rounded-lg p-4 border border-orange-800/50">
              <div className="text-4xl font-black text-orange-400 mb-2 animate-pulse">
                {formatNumber(seasonAwards?.bestBomber?.value || 0)}
              </div>
              <div className="text-xs text-orange-300/80 uppercase tracking-wider mb-3">
                Bomb Damage
              </div>

              <div className="text-2xl font-bold">
                <PlayerLink playerName={seasonAwards?.bestBomber?.player || ''}>
                  <span
                    className="text-transparent bg-clip-text bg-linear-to-r from-orange-400 via-yellow-400 to-orange-400 animate-[shimmer_3s_linear_infinite]"
                    style={{
                      backgroundSize: '200% auto',
                      textShadow: '0 0 20px rgba(234, 88, 12, 0.8)'
                    }}
                  >
                    {seasonAwards?.bestBomber?.player || 'AWAITING CHAMPION'}
                  </span>
                </PlayerLink>
              </div>
            </div>

            <div className="mt-4 text-xs text-orange-400/60 italic">
              &quot;Blessed is the mind too small for doubt&quot;
            </div>

            {/* Bottom explosion effect */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-linear-to-r from-transparent via-orange-600 to-transparent opacity-80 animate-[plasmaFlow_3s_ease-in-out_infinite]"></div>
          </div>
        </div>
      </div>
    </>
  )
}

export default memo(VOTLWSeasonStats)
