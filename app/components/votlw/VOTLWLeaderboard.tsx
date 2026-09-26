'use client'

import { useState, memo, useMemo, useRef } from 'react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { PlayerPoints } from '@tacticus/app-core/votlw.types'

interface VOTLWLeaderboardProps {
  playerPoints: PlayerPoints[]
}

function VOTLWLeaderboard({ playerPoints }: VOTLWLeaderboardProps) {
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboardSearch, setLeaderboardSearch] = useState('')
  const [scrollTop, setScrollTop] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const ITEM_HEIGHT = 45 // Height of each table row in pixels
  const CONTAINER_HEIGHT = 400 // Max height of scrollable container
  const BUFFER_SIZE = 5 // Number of items to render outside viewport

  const filteredPlayers = useMemo(() => {
    return playerPoints.filter((p) =>
      p.displayName.toLowerCase().includes(leaderboardSearch.toLowerCase())
    )
  }, [playerPoints, leaderboardSearch])

  const { visibleItems, totalHeight, offsetY } = useMemo(() => {
    const itemCount = filteredPlayers.length
    const visibleCount = Math.ceil(CONTAINER_HEIGHT / ITEM_HEIGHT)
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE
    )
    const endIndex = Math.min(
      itemCount,
      startIndex + visibleCount + BUFFER_SIZE * 2
    )

    return {
      visibleItems: filteredPlayers
        .slice(startIndex, endIndex)
        .map((player, idx) => ({
          player,
          index: startIndex + idx
        })),
      totalHeight: itemCount * ITEM_HEIGHT,
      offsetY: startIndex * ITEM_HEIGHT
    }
  }, [filteredPlayers, scrollTop, ITEM_HEIGHT, CONTAINER_HEIGHT, BUFFER_SIZE])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  return (
    <div className="relative overflow-hidden rounded-lg border-2 border-yellow-700/30 bg-gradient-to-br from-yellow-950/20 via-black to-yellow-950/20 p-6">
      {/* Decorative elements */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(234,179,8,0.03)_10px,rgba(234,179,8,0.03)_20px)]" />
      </div>

      <div className="absolute -top-12 -right-12 w-48 h-48 text-yellow-900/20 transform rotate-12">
        🏆
      </div>

      <div className="relative z-10">
        {/* Header with toggle button - responsive layout */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-4">
          <h3 className="text-2xl font-black uppercase tracking-wider">
            <span
              className="bg-gradient-to-r from-yellow-500 via-amber-500 to-yellow-500 bg-clip-text text-transparent animate-[shimmer_3s_ease-in-out_infinite]"
              style={{ backgroundSize: '200% auto' }}
            >
              Battle Leaderboard
            </span>
            <div className="text-xs text-yellow-400/60 mt-1">
              Full Season Rankings
            </div>
          </h3>

          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className="px-4 py-2 bg-yellow-900/30 border border-yellow-600/50 rounded-lg hover:bg-yellow-800/40 transition-all duration-300 flex items-center justify-center gap-2 text-yellow-400 w-full md:w-auto"
          >
            <span className="text-lg">{showLeaderboard ? '📊' : '📈'}</span>
            <span className="text-sm font-bold">
              {showLeaderboard ? 'Hide' : 'Show'} Full Rankings
            </span>
            <span
              className={`transition-transform ${showLeaderboard ? 'rotate-180' : ''}`}
            >
              ▼
            </span>
          </button>
        </div>

        {/* Top 3 Always Visible */}
        <div className="space-y-3 mb-4">
          {playerPoints.slice(0, 3).map((player, index) => {
            const medals = ['🥇', '🥈', '🥉'][index]
            const borderColors = [
              'border-yellow-500',
              'border-gray-400',
              'border-orange-600'
            ][index]
            const glowColors = [
              'shadow-[0_0_20px_rgba(234,179,8,0.5)]',
              'shadow-[0_0_20px_rgba(156,163,175,0.3)]',
              'shadow-[0_0_20px_rgba(234,88,12,0.3)]'
            ][index]

            return (
              <div
                key={player.displayName}
                className={`relative p-4 rounded-lg border-2 ${borderColors} ${glowColors} bg-gradient-to-br from-black/80 to-yellow-950/30 hover:scale-[1.02] transition-transform`}
              >
                <div className="absolute -top-3 -left-3 text-4xl">{medals}</div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-lg text-yellow-100 ml-6">
                    <PlayerLink playerName={player.displayName}>
                      {player.displayName}
                    </PlayerLink>
                  </span>
                  <span className="font-black text-2xl bg-gradient-to-r from-yellow-400 to-amber-400 bg-clip-text text-transparent">
                    {player.totalPoints} pts
                  </span>
                </div>

                <div className="text-xs text-yellow-200/80 space-y-1">
                  <div className="flex flex-wrap gap-3">
                    {player.awards.goldMedals > 0 && (
                      <span className="bg-yellow-900/30 px-2 py-1 rounded">
                        🥇 {player.awards.goldMedals}
                      </span>
                    )}
                    {player.awards.silverMedals > 0 && (
                      <span className="bg-card/30 px-2 py-1 rounded">
                        🥈 {player.awards.silverMedals}
                      </span>
                    )}
                    {player.awards.bronzeMedals > 0 && (
                      <span className="bg-orange-900/30 px-2 py-1 rounded">
                        🥉 {player.awards.bronzeMedals}
                      </span>
                    )}
                    {player.awards.mostDamageAwards > 0 && (
                      <span className="bg-red-900/30 px-2 py-1 rounded">
                        💥 {player.awards.mostDamageAwards}
                      </span>
                    )}
                    {(player.awards.sideBoss1Wins || 0) +
                      (player.awards.sideBoss2Wins || 0) >
                      0 && (
                      <span className="bg-purple-900/30 px-2 py-1 rounded">
                        👹{' '}
                        {(player.awards.sideBoss1Wins || 0) +
                          (player.awards.sideBoss2Wins || 0)}
                      </span>
                    )}
                    {player.awards.biggestHitAwards > 0 && (
                      <span className="bg-blue-900/30 px-2 py-1 rounded">
                        🎯 {player.awards.biggestHitAwards}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2">
                    <span className="text-yellow-400">
                      ⚔️ Avg: {formatNumber(player.avgDamagePerHit)}
                    </span>
                    <span className="text-yellow-400">
                      🎫 Tokens Spent: {formatNumber(player.tokenCount)}
                    </span>
                    <span className="text-yellow-300">
                      🧹 Sweeps: {formatNumber(player.sweeps)}
                    </span>
                    <span className="text-purple-300">
                      ⚡ One-Shots: {formatNumber(player.oneShots)}
                    </span>
                    <span className="text-orange-300">
                      💣 Bombs: {formatNumber(player.bombsUsed)}
                    </span>
                    <span className="text-red-300">
                      ⚠️ Crashes: {formatNumber(player.crashes)}
                    </span>
                  </div>
                  {player.awards.topKiller && (
                    <div className="text-green-400 font-bold">
                      🔪 TOP KILLER
                    </div>
                  )}
                  {player.awards.bestBomber && (
                    <div className="text-orange-400 font-bold">
                      💣 BEST BOMBER
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Collapsible Full Leaderboard */}
        {showLeaderboard && (
          <div className="mt-6 p-4 bg-black/60 rounded-lg border border-yellow-800/30">
            {/* Search and Pagination Controls */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
              <input
                type="text"
                placeholder="🔍 Search player..."
                value={leaderboardSearch}
                onChange={(e) => {
                  setLeaderboardSearch(e.target.value)
                  setScrollTop(0) // Reset scroll position on search
                }}
                className="px-4 py-2 bg-yellow-950/30 border border-yellow-700/50 rounded-lg text-yellow-100 placeholder-yellow-600/50 focus:outline-none focus:border-yellow-500 w-full md:w-64"
              />

              {/* Results Info */}
              <div className="text-sm text-yellow-400">
                {filteredPlayers.length} of {playerPoints.length} players
              </div>
            </div>

            {/* Virtual Scrolling Leaderboard */}
            <div className="overflow-x-auto">
              <div className="w-full text-sm">
                {/* Fixed Header */}
                <div className="border-b border-yellow-700/50 bg-black/40 sticky top-0 z-10">
                  <div className="flex min-w-[1200px]">
                    <div className="flex-shrink-0 w-12 p-2 text-yellow-400 font-medium">
                      #
                    </div>
                    <div className="flex-shrink-0 w-48 p-2 text-yellow-400 font-medium">
                      Player
                    </div>
                    <div className="flex-shrink-0 w-20 p-2 text-center text-yellow-400 font-medium">
                      Points
                    </div>
                    <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-400 font-medium">
                      🥇
                    </div>
                    <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-400 font-medium">
                      🥈
                    </div>
                    <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-400 font-medium">
                      🥉
                    </div>
                    <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-400 font-medium">
                      💥
                    </div>
                    <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-400 font-medium">
                      👹
                    </div>
                    <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-400 font-medium">
                      🎯
                    </div>
                    <div className="flex-shrink-0 w-24 p-2 text-center text-yellow-400 font-medium">
                      Avg Dmg
                    </div>
                    <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-400 font-medium">
                      🎫 Tokens
                    </div>
                    <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-400 font-medium">
                      🧹 Sweeps
                    </div>
                    <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-400 font-medium">
                      ⚡ One-Shots
                    </div>
                    <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-400 font-medium">
                      💣 Bombs
                    </div>
                    <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-400 font-medium">
                      ⚠️ Crashes
                    </div>
                  </div>
                </div>

                {/* Virtual Scrolling Container */}
                <div
                  ref={containerRef}
                  className="overflow-auto"
                  style={{ height: `${CONTAINER_HEIGHT}px` }}
                  onScroll={handleScroll}
                >
                  {/* Total height container for proper scrollbar */}
                  <div
                    style={{ height: `${totalHeight}px`, position: 'relative' }}
                  >
                    {/* Visible items container */}
                    <div
                      style={{
                        transform: `translateY(${offsetY}px)`,
                        position: 'absolute',
                        width: '100%'
                      }}
                    >
                      {visibleItems.map(({ player, index }) => (
                        <div
                          key={player.displayName}
                          className="flex min-w-[1200px] border-b border-yellow-900/20 hover:bg-yellow-950/20 transition-colors"
                          style={{ height: `${ITEM_HEIGHT}px` }}
                        >
                          <div className="flex-shrink-0 w-12 p-2 font-bold text-yellow-600 flex items-center">
                            {index + 1}
                          </div>
                          <div className="flex-shrink-0 w-48 p-2 flex items-center">
                            <PlayerLink playerName={player.displayName}>
                              <span className="text-yellow-100 hover:text-yellow-300 transition-colors">
                                {player.displayName}
                              </span>
                            </PlayerLink>
                            {player.awards.topKiller && (
                              <span className="ml-2 text-green-400 text-xs">
                                🔪
                              </span>
                            )}
                            {player.awards.bestBomber && (
                              <span className="ml-2 text-orange-400 text-xs">
                                💣
                              </span>
                            )}
                          </div>
                          <div className="flex-shrink-0 w-20 p-2 text-center font-bold text-yellow-400 flex items-center justify-center">
                            {player.totalPoints}
                          </div>
                          <div className="flex-shrink-0 w-12 p-2 text-center text-yellow-300 flex items-center justify-center">
                            {player.awards.goldMedals || '-'}
                          </div>
                          <div className="flex-shrink-0 w-12 p-2 text-center text-[var(--text-primary)] flex items-center justify-center">
                            {player.awards.silverMedals || '-'}
                          </div>
                          <div className="flex-shrink-0 w-12 p-2 text-center text-orange-400 flex items-center justify-center">
                            {player.awards.bronzeMedals || '-'}
                          </div>
                          <div className="flex-shrink-0 w-12 p-2 text-center text-red-400 flex items-center justify-center">
                            {player.awards.mostDamageAwards || '-'}
                          </div>
                          <div className="flex-shrink-0 w-12 p-2 text-center text-purple-400 flex items-center justify-center">
                            {(player.awards.sideBoss1Wins || 0) +
                              (player.awards.sideBoss2Wins || 0) || '-'}
                          </div>
                          <div className="flex-shrink-0 w-12 p-2 text-center text-blue-400 flex items-center justify-center">
                            {player.awards.biggestHitAwards || '-'}
                          </div>
                          <div className="flex-shrink-0 w-24 p-2 text-center text-yellow-200 flex items-center justify-center">
                            {formatNumber(player.avgDamagePerHit)}
                          </div>
                          <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-200 flex items-center justify-center">
                            {formatNumber(player.tokenCount)}
                          </div>
                          <div className="flex-shrink-0 w-16 p-2 text-center text-yellow-200 flex items-center justify-center">
                            {formatNumber(player.sweeps)}
                          </div>
                          <div className="flex-shrink-0 w-16 p-2 text-center text-purple-200 flex items-center justify-center">
                            {formatNumber(player.oneShots)}
                          </div>
                          <div className="flex-shrink-0 w-16 p-2 text-center text-orange-200 flex items-center justify-center">
                            {formatNumber(player.bombsUsed)}
                          </div>
                          <div className="flex-shrink-0 w-16 p-2 text-center text-red-200 flex items-center justify-center">
                            {formatNumber(player.crashes)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(VOTLWLeaderboard)
