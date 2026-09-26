'use client'

import { memo } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { MechanicusEmptyState as EmptyState } from '@tacticus/ui-kit/loading'
import { formatDamage } from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type { SetWinner } from '@tacticus/app-core/votlw.types'

interface VOTLWIndividualAwardsProps {
  setWinners: SetWinner[]
}

function VOTLWIndividualAwards({ setWinners }: VOTLWIndividualAwardsProps) {
  // Sets with data only, Mythic first (M5-M1), then Legendary (L5-L1).
  const sortedWinners = [...setWinners]
    .filter((set) => {
      return (
        set.gold ||
        set.silver ||
        set.bronze ||
        set.mostDamage ||
        set.biggestHit ||
        set.sideBoss1 ||
        set.sideBoss2
      )
    })
    .sort((a, b) => {
      if (a.rarity === 'Mythic' && b.rarity !== 'Mythic') return -1
      if (a.rarity !== 'Mythic' && b.rarity === 'Mythic') return 1
      return b.set - a.set
    })

  return (
    <div className="relative overflow-hidden rounded-lg border-2 border-purple-700/30 bg-gradient-to-br from-purple-950/20 via-black to-purple-950/20 p-6">
      {/* Decorative elements */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(147,51,234,0.03)_10px,rgba(147,51,234,0.03)_20px)]" />
      </div>

      <div className="absolute -top-12 -left-12 w-48 h-48 text-purple-900/20 transform -rotate-12">
        ⚔️
      </div>
      <div className="absolute bottom-0 right-0 w-48 h-48 text-purple-900/20 transform rotate-12">
        🏆
      </div>

      <div className="relative z-10">
        <h3 className="text-2xl font-black mb-4 uppercase tracking-wider">
          <span
            className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 bg-clip-text text-transparent animate-[shimmer_3s_ease-in-out_infinite]"
            style={{ backgroundSize: '200% auto' }}
          >
            Champion Stats
          </span>
          <div className="text-xs text-purple-400/60 mt-1">
            Battle Records & Achievements
          </div>
        </h3>

        {/* Responsive info for desktop */}
        {sortedWinners.length > 0 && (
          <div className="hidden lg:block text-xs text-purple-400/40 mb-2">
            Showing: Level, Boss Name, all award categories
          </div>
        )}

        {sortedWinners.length === 0 ? (
          <EmptyState
            title="No Data Available"
            description="No Champion Stats Available"
          />
        ) : (
          <>
            {/* Desktop Table View - Two-line layout for better space utilization */}
            <div className="hidden lg:block">
              <div className="overflow-x-auto rounded-lg bg-black/40">
                <table className="w-full text-xs 2xl:text-sm">
                  <thead className="bg-purple-950/30 border-b-2 border-purple-700/50">
                    <tr className="text-purple-400">
                      <th className="w-24 p-2 text-left font-black uppercase tracking-wider text-xs">
                        Battle
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        🥇 Gold Medal
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        🥈 Silver Medal
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        🥉 Bronze Medal
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        💥 Most DMG
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        👹 Side 1
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        👹 Side 2
                      </th>
                      <th className="p-2 text-center border-l border-purple-800/30">
                        🎯 Big Hit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedWinners.map((set) => (
                      <tr
                        key={`${set.rarity}-${set.set}`}
                        className={`border-b border-purple-900/20 hover:bg-purple-950/20 transition-colors ${set.rarity === 'Mythic' ? 'bg-orange-900/10' : ''}`}
                      >
                        {/* Battle Column - Two lines: Level + Boss Name */}
                        <td
                          className={`p-2 font-black text-sm ${set.rarity === 'Mythic' ? 'text-orange-400' : 'text-purple-400'}`}
                        >
                          <div className="text-sm font-black">
                            {set.levelString}
                          </div>
                          <div
                            className="text-xs text-purple-300/60 mt-0.5 truncate"
                            title={getBossDisplayName(set.bossName)}
                          >
                            {getBossDisplayName(set.bossName)}
                          </div>
                        </td>

                        {/* Gold Medal - Two lines: Player + Damage */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.gold ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.gold}>
                                  <span className="text-yellow-400 hover:text-yellow-300">
                                    {set.gold}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-yellow-300/60 mt-0.5">
                                {set.goldValue
                                  ? formatDamage(set.goldValue, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>

                        {/* Silver Medal - Two lines: Player + Damage */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.silver ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.silver}>
                                  <span className="text-[var(--text-primary)] hover:text-white">
                                    {set.silver}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-[color-mix(in_srgb,var(--text-secondary)_60%,transparent)] mt-0.5">
                                {set.silverValue
                                  ? formatDamage(set.silverValue, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>

                        {/* Bronze Medal - Two lines: Player + Damage */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.bronze ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.bronze}>
                                  <span className="text-orange-500 hover:text-orange-400">
                                    {set.bronze}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-orange-400/60 mt-0.5">
                                {set.bronzeValue
                                  ? formatDamage(set.bronzeValue, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>

                        {/* Most Damage - Hidden on smaller screens */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.mostDamage ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.mostDamage}>
                                  <span className="text-red-400 hover:text-red-300">
                                    {set.mostDamage}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-red-400/60 mt-0.5">
                                {set.mostDamageValue
                                  ? formatDamage(set.mostDamageValue, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>

                        {/* Side Boss 1 - Hidden on smaller screens */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.sideBoss1 ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.sideBoss1}>
                                  <span className="text-purple-400 hover:text-purple-300">
                                    {set.sideBoss1}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-purple-400/60 mt-0.5">
                                {set.sideBoss1Value
                                  ? formatDamage(set.sideBoss1Value, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>

                        {/* Side Boss 2 - Hidden on smaller screens */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.sideBoss2 ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.sideBoss2}>
                                  <span className="text-purple-400 hover:text-purple-300">
                                    {set.sideBoss2}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-purple-400/60 mt-0.5">
                                {set.sideBoss2Value
                                  ? formatDamage(set.sideBoss2Value, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>

                        {/* Biggest Hit - Hidden on smaller screens */}
                        <td className="p-2 border-l border-purple-800/20 text-center">
                          {set.biggestHit ? (
                            <>
                              <div className="text-xs font-semibold truncate">
                                <PlayerLink playerName={set.biggestHit}>
                                  <span className="text-blue-400 hover:text-blue-300">
                                    {set.biggestHit}
                                  </span>
                                </PlayerLink>
                              </div>
                              <div className="text-xs text-blue-400/60 mt-0.5">
                                {set.biggestHitValue
                                  ? formatDamage(set.biggestHitValue, 1)
                                  : '-'}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs text-[var(--text-secondary)]">
                              -
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-4">
              {sortedWinners.map((set) => (
                <div
                  key={`${set.rarity}-${set.set}`}
                  className={`border rounded-lg p-4 ${
                    set.rarity === 'Mythic'
                      ? 'bg-orange-900/20 border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
                      : 'bg-card/50 border-primary-wh40k'
                  }`}
                >
                  <div
                    className={`text-lg font-bold mb-3 ${
                      set.rarity === 'Mythic'
                        ? 'text-[var(--accent)]'
                        : 'text-[var(--accent)]'
                    }`}
                  >
                    {set.levelString} - {getBossDisplayName(set.bossName)}
                  </div>

                  {/* Medal Winners */}
                  <div className="space-y-3 mb-4">
                    {set.gold && (
                      <div className="flex items-center justify-between p-2 bg-yellow-900/20 rounded">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🥇</span>
                          <div>
                            <div className="font-medium">
                              <PlayerLink playerName={set.gold}>
                                {set.gold}
                              </PlayerLink>
                            </div>
                            <div className="text-xs text-text-muted">
                              Avg:{' '}
                              {set.goldValue
                                ? formatDamage(set.goldValue, 1)
                                : '-'}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-[var(--primary)]">
                          Gold
                        </div>
                      </div>
                    )}

                    {set.silver && (
                      <div className="flex items-center justify-between p-2 bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🥈</span>
                          <div>
                            <div className="font-medium">
                              <PlayerLink playerName={set.silver}>
                                {set.silver}
                              </PlayerLink>
                            </div>
                            <div className="text-xs text-text-muted">
                              Avg:{' '}
                              {set.silverValue
                                ? formatDamage(set.silverValue, 1)
                                : '-'}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-[var(--text-secondary)]">
                          Silver
                        </div>
                      </div>
                    )}

                    {set.bronze && (
                      <div className="flex items-center justify-between p-2 bg-orange-900/20 rounded">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🥉</span>
                          <div>
                            <div className="font-medium">
                              <PlayerLink playerName={set.bronze}>
                                {set.bronze}
                              </PlayerLink>
                            </div>
                            <div className="text-xs text-text-muted">
                              Avg:{' '}
                              {set.bronzeValue
                                ? formatDamage(set.bronzeValue, 1)
                                : '-'}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-orange-600">
                          Bronze
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Other Awards Grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {set.mostDamage && (
                      <div className="p-2 bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded">
                        <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
                          <span>💥</span> Most Damage
                        </div>
                        <div className="font-medium">
                          <PlayerLink playerName={set.mostDamage}>
                            {set.mostDamage}
                          </PlayerLink>
                        </div>
                        <div className="text-xs text-text-muted">
                          {set.mostDamageValue
                            ? formatDamage(set.mostDamageValue, 1)
                            : '-'}
                        </div>
                      </div>
                    )}

                    {set.biggestHit && (
                      <div className="p-2 bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded">
                        <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
                          <span>🎯</span> Biggest Hit
                        </div>
                        <div className="font-medium">
                          <PlayerLink playerName={set.biggestHit}>
                            {set.biggestHit}
                          </PlayerLink>
                        </div>
                        <div className="text-xs text-text-muted">
                          {set.biggestHitValue
                            ? formatDamage(set.biggestHitValue, 1)
                            : '-'}
                        </div>
                      </div>
                    )}

                    {set.sideBoss1 && (
                      <div className="p-2 bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded">
                        <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
                          <span>👹</span> Side Boss 1
                        </div>
                        <div className="font-medium">
                          <PlayerLink playerName={set.sideBoss1}>
                            {set.sideBoss1}
                          </PlayerLink>
                        </div>
                        <div className="text-xs text-text-muted">
                          {set.sideBoss1Value
                            ? formatDamage(set.sideBoss1Value, 1)
                            : '-'}
                        </div>
                      </div>
                    )}

                    {set.sideBoss2 && (
                      <div className="p-2 bg-card/30 hover:bg-card/80 transition-colors duration-200 rounded">
                        <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
                          <span>👹</span> Side Boss 2
                        </div>
                        <div className="font-medium">
                          <PlayerLink playerName={set.sideBoss2}>
                            {set.sideBoss2}
                          </PlayerLink>
                        </div>
                        <div className="text-xs text-text-muted">
                          {set.sideBoss2Value
                            ? formatDamage(set.sideBoss2Value, 1)
                            : '-'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default memo(VOTLWIndividualAwards)
