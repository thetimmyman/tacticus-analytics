'use client'

import { useState } from 'react'

export function OverallLeaderboardCalculationsFAQ() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-3 bg-(--card-bg) hover:bg-(--bg-tertiary) rounded-lg border border-(--card-border) transition-colors"
      >
        <h3 className="text-lg font-bold text-(--primary)">
          How Overall Leaderboard Works - Detailed Calculations
        </h3>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <svg
            className="w-5 h-5 text-secondary-wh40k"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="space-y-6 p-4 bg-(--bg-secondary) hover:bg-card/80 transition-colors duration-200 rounded-lg border border-(--card-border)">
          <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-4">
            <h4 className="text-(--accent) font-bold mb-3 flex items-center">
              Overall Leaderboard Overview
            </h4>
            <div className="text-sm text-secondary-wh40k space-y-2">
              <p className="text-primary-wh40k">
                The Overall Leaderboard ranks players by{' '}
                <span className="font-bold">performance efficiency</span> rather
                than raw damage totals:
              </p>
              <div className="ml-4 space-y-1">
                <p>
                  <span className="text-(--primary)">% vs Cluster:</span>{' '}
                  Primary ranking metric - efficiency compared to cluster
                  average
                </p>
                <p>
                  <span className="text-green-400">Historical Tracking:</span>{' '}
                  5-season average and prior season comparison
                </p>
                <p>
                  <span className="text-yellow-400">Dynamic Sorting:</span>{' '}
                  Multiple sorting options while preserving performance ranks
                </p>
                <p>
                  <span className="text-purple-400">Statistical Balance:</span>{' '}
                  Fair comparison across different activity levels
                </p>
                <p>
                  <span className="text-(--accent)">Multi-Column Data:</span>{' '}
                  Total damage, battles, bombs, kills tracking
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              Performance Efficiency Algorithm
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 1: Cluster Baseline Calculation
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-blue-900/30 p-2 rounded-sm">
                    Boss_Avg[boss_key] = Σ(all_damage_to_boss) ÷
                    COUNT(all_battles_to_boss)
                  </p>
                  <p>
                    <span className="text-yellow-400">Purpose:</span> Establish
                    cluster-wide performance baseline for each boss
                  </p>
                  <p className="ml-4">
                    → Each boss+set gets individual average:{' '}
                    <span className="text-(--accent)">
                      Necron_set4 = 45M, Szarekh_set3 = 52M
                    </span>
                  </p>
                  <p className="text-blue-400 text-xs">
                    Boss key: Boss name + set number (different sets = different
                    difficulty)
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 2: Player Average Per Boss
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-green-900/30 p-2 rounded-sm">
                    Player_Avg[boss] = Σ(player_damage_to_boss) ÷
                    COUNT(player_battles_to_boss)
                  </p>
                  <p>
                    <span className="text-yellow-400">Example:</span> Player
                    fights Necron twice: 60M, 70M
                  </p>
                  <p className="ml-4">
                    → Player avg for Necron = (60M + 70M) ÷ 2 ={' '}
                    <span className="text-(--accent)">65M</span>
                  </p>
                  <p className="text-green-400 text-xs">
                    Groups battles by boss to calculate average performance per
                    boss type
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 3: Weighted Performance Average
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-purple-900/30 p-2 rounded-sm">
                    Weighted_Avg = Σ((Player_Avg[boss] ÷ Cluster_Avg[boss] - 1)
                    × battles[boss]) ÷ total_battles
                  </p>
                  <p>
                    <span className="text-(--accent)">Weighting:</span> Bosses
                    with more battles have proportionally more influence
                  </p>
                  <p>
                    <span className="text-yellow-400">Example:</span> Boss A:
                    65M avg (2 battles), cluster 50M | Boss B: 90M avg (1
                    battle), cluster 100M
                  </p>
                  <p className="ml-4">
                    → Weighted = ((65/50 - 1) × 2 + (90/100 - 1) × 1) ÷ 3 ={' '}
                    <span className="text-(--accent)">+16.7%</span>
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 4: Percentage Conversion
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-yellow-900/30 p-2 rounded-sm">
                    % vs Cluster = Already calculated in Step 3
                  </p>
                  <p>
                    <span className="text-yellow-400">Final Result:</span> The
                    weighted average from Step 3 ={' '}
                    <span className="text-(--accent)">+16.7%</span>
                  </p>
                  <p className="text-green-400 text-xs">
                    Positive = above cluster average, Negative = below cluster
                    average
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              Historical Ranking Calculations
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Current Season Ranking
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-blue-900/30 p-2 rounded-sm">
                    Current_Rank = RANK() OVER (ORDER BY percent_vs_cluster
                    DESC)
                  </p>
                  <p>
                    <span className="text-(--accent)">Static Assignment:</span>{' '}
                    Rank calculated once and preserved during sorting
                  </p>
                  <p>
                    <span className="text-yellow-400">Medal System:</span> Rank
                    1-3 are highlighted as top ranks
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Prior Season Comparison
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-green-900/30 p-2 rounded-sm">
                    Rank_Change = Prior_Season_Rank - Current_Season_Rank
                  </p>
                  <p>
                    <span className="text-green-400">Positive Change:</span> ↑
                    +5 (moved up 5 positions)
                  </p>
                  <p>
                    <span className="text-red-400">Negative Change:</span> ↓ -3
                    (dropped 3 positions)
                  </p>
                  <p>
                    <span className="text-secondary-wh40k">New Players:</span>{' '}
                    &quot;NEW&quot; indicator for first-time rankings
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  5-Season Average Algorithm
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-purple-900/30 p-2 rounded-sm">
                    Five_Season_Avg = Σ(available_historical_ranks) ÷
                    COUNT(seasons_with_data)
                  </p>
                  <p>
                    <span className="text-yellow-400">Example:</span> Historical
                    ranks: #3, #7, #2, #5 across 4 seasons
                  </p>
                  <p className="ml-4">
                    → Average = (3 + 7 + 2 + 5) ÷ 4 ={' '}
                    <span className="text-(--accent)">#4.3</span>
                  </p>
                  <p className="text-purple-400 text-xs">
                    Only includes seasons where player had battle data
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
