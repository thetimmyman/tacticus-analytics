export function PerformanceFAQ() {
  return (
    <details
      className="card-wh40k p-4 sm:p-6 mt-6 group"
      data-component="performance-faq"
    >
      <summary className="flex items-center justify-between w-full text-left py-2 sm:py-0 min-h-[44px] sm:min-h-0 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h3 className="text-lg sm:text-xl font-bold text-primary-wh40k group-open:text-(--primary) transition-colors pr-2">
          How Performance Calculations Work
        </h3>
        <div className="transition-transform duration-200 shrink-0 group-open:rotate-180">
          <svg
            className="w-6 h-6 sm:w-5 sm:h-5 text-secondary-wh40k"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </summary>

      <div className="space-y-4 sm:space-y-6 pt-4 border-t border-(--card-border)">
        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Weighted Performance Chart - Calculation Method
          </h4>
          <div className="pl-2 sm:pl-4 space-y-2 text-xs sm:text-sm text-secondary-wh40k">
            <p className="text-xs text-secondary-wh40k">
              <strong className="text-primary-wh40k">
                Final token-weighted formula:
              </strong>
              <span className="block mt-1">
                <code>
                  tokenScore = (1 + weightedAvg) * (tokens_spent /
                  tokens_possible) - 1
                </code>
              </span>
            </p>
            <p className="text-secondary-wh40k">
              <strong>Token baseline:</strong> choose between the seasonal max
              tokens possible (including burned tokens) or the seasonal average
              tokens spent. The baseline is guild-scoped when comparing to guild
              averages, and cluster-scoped when comparing to cluster averages.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-xs text-secondary-wh40k">
              <li>Guild max tokens possible</li>
              <li>Cluster max tokens possible</li>
              <li>Guild average tokens spent</li>
              <li>Cluster average tokens spent</li>
            </ul>
            <p className="text-secondary-wh40k text-xs">
              Ratios above 1 are clamped to avoid inflating token-weighted
              scores.
            </p>
          </div>
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Battle-Weighted Calculation Steps
          </h4>
          <div className="pl-2 sm:pl-4 space-y-2 text-xs sm:text-sm text-secondary-wh40k">
            <div className="leading-relaxed">
              <strong className="text-primary-wh40k">
                Token-Weighted Algorithm:
              </strong>{' '}
              Multi-step weighted average calculation:
            </div>
            <div className="pl-4 space-y-1 text-xs">
              <div>
                <strong className="text-yellow-400">Step 1:</strong> For each
                boss, calculate guild/cluster average damage per battle
              </div>
              <div>
                <strong className="text-yellow-400">Step 2:</strong> For each
                player-boss combination: (Player Avg - Boss Avg) / Boss Avg x
                100
              </div>
              <div>
                <strong className="text-yellow-400">Step 3:</strong> Weight each
                boss percentage by battles fought on that boss
              </div>
              <div>
                <strong className="text-yellow-400">Step 4:</strong> Final score
                = sum(Boss% x BattleCount) / sum(BattleCount)
              </div>
              <div className="text-green-400 mt-1">
                <strong>Example:</strong> Player A: Boss1 (+20%, 3 battles),
                Boss2 (+10%, 2 battles)
              </div>
              <div className="text-green-400">
                Weighted Average: (20x3 + 10x2) / (3+2) = 80/5 = +16%
              </div>
            </div>
          </div>
          <p className="text-xs text-secondary-wh40k">
            Token weighting defaults to the max baseline for the selected
            compare context (guild or cluster). You can switch to the average
            baseline to soften the penalty for missed tokens, while burned
            tokens inflate the max cap to reflect wasted availability. When live
            token stats are still loading, both baselines fall back to each
            player&apos;s share of legendary/mythic battles.
          </p>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Chart Interpretation &amp; Thresholds
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p className="leading-relaxed">
              Values represent weighted performance vs selected comparison.
              Positive percentages mean the player is outperforming the
              baseline; negatives indicate underperformance.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-green-500 rounded-sm"></div>
                <span className="text-secondary-wh40k leading-relaxed">
                  +30% and above (Exceptional)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-green-400 rounded-sm"></div>
                <span className="text-secondary-wh40k leading-relaxed">
                  +20% to +29% (Great)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-yellow-400 rounded-sm"></div>
                <span className="text-secondary-wh40k leading-relaxed">
                  +5% to +19% (Solid)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-purple-400 rounded-sm"></div>
                <span className="text-secondary-wh40k leading-relaxed">
                  0% to +4% (Meets Baseline)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-orange-400 rounded-sm"></div>
                <span className="text-secondary-wh40k leading-relaxed">
                  -1% to -15% (Needs Work)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-3 bg-red-500 rounded-sm"></div>
                <span className="text-secondary-wh40k leading-relaxed">
                  Below -15% (Critical)
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Token-Weighted Mode Details
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p>
              Token weighting adjusts performance based on relative token spend
              to highlight efficiency.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>
                <strong>Max baseline:</strong> Uses the highest tokens possible
                in the selected context (guild or cluster); strictest penalty
                for missed tokens.
              </li>
              <li>
                <strong>Average baseline:</strong> Uses the average tokens spent
                in the selected context; softer penalty when participation
                varies.
              </li>
              <li>
                <strong>Fallback ratios:</strong> When token stats are missing,
                uses share of legendary/mythic participation.
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Rarity &amp; Filtering Notes
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p>
              Only Legendary/Mythic battles are included by default. Use the
              rarity filter to add additional tiers.
            </p>
            <p>Bomb runs and sweeps are excluded to keep comparisons clean.</p>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Bar Chart Visualization
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p>
              Bars extend horizontally from the centre line. Positive
              performance pushes to the right, negative to the left.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>
                <strong>Scale:</strong> Bar width = |Performance %| / max chart
                value * 100
              </li>
              <li>
                <strong>Direction:</strong> Positive values to the right,
                negative values to the left
              </li>
              <li>
                <strong>Colours:</strong> Green (exceptional), yellow (average),
                red (needs improvement)
              </li>
              <li>
                <strong>Sorting:</strong> Players appear in descending order by
                performance percentage
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Boss-by-Boss Detail Table
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p>
              The optional table breaks out individual boss performance when the
              toggle is enabled.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>
                <strong>Weighted contribution:</strong> Player avg damage x
                number of battles on that boss (e.g. 150k x 4 = 600k)
              </li>
              <li>
                <strong>Per-boss %:</strong> (Player Avg - Guild/Cluster Avg) /
                Guild/Cluster Avg x 100
              </li>
              <li>
                <strong>Scope:</strong> Only players who fought the specific
                boss appear
              </li>
              <li>
                <strong>Sorting:</strong> Highest performance percentage is
                shown first
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Guild vs Cluster Radar Charts
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p>
              Available to cluster-enabled users, showing how the guild stacks
              up boss by boss.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>
                <strong>Calculation:</strong> (Guild Avg - Cluster Avg) /
                Cluster Avg x 100, clamped to +/-50%
              </li>
              <li>
                <strong>Workflow:</strong> Step through boss averages for guild
                and cluster, then compute the delta
              </li>
              <li>
                <strong>Features:</strong> Separate charts for bosses and
                primes, labelled by tier, with the cluster baseline fixed at 0%
              </li>
              <li>
                <strong>Visuals:</strong> Blue area = guild performance; dashed
                ring = cluster baseline
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <h4 className="text-base sm:text-lg font-semibold text-(--accent) flex items-center">
            <span className="w-2 h-2 bg-accent-wh40k rounded-full mr-2 shrink-0"></span>
            Performance Summary Widgets
          </h4>
          <div className="pl-2 sm:pl-4 text-xs sm:text-sm text-secondary-wh40k space-y-2">
            <p>Quick stats to highlight distribution and top performers.</p>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>
                <strong>Above/Below Average:</strong> Counts players above 0%
                and below 0%
              </li>
              <li>
                <strong>Top Performer:</strong> Highest weighted (or
                token-weighted) percentage
              </li>
              <li>
                <strong>Qualified Players:</strong> Number of players with at
                least one legendary/mythic battle
              </li>
              <li>
                <strong>Token mode info:</strong> Indicates whether ratios come
                from live token stats or the participation-share fallback
              </li>
            </ul>
          </div>
        </div>
      </div>
    </details>
  )
}
