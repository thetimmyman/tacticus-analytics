'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  META_ANALYSIS_GLOBAL_SCOPE_DETAIL,
  META_ANALYSIS_GLOBAL_SCOPE_NOTICE,
  META_ANALYSIS_MY_GUILD_HREF,
  META_ANALYSIS_MY_GUILD_LINK_LABEL
} from '@/app/lib/meta/meta-analysis-scope'

export function MetaAnalysisCalculationsFAQ() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-3 bg-(--card-bg) hover:bg-(--bg-tertiary) rounded-lg border border-(--card-border) transition-colors"
      >
        <h3 className="text-lg font-bold text-(--primary)">
          How Meta Analysis Works
        </h3>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <svg
            className="w-5 h-5 text-secondary-wh40k"
            fill="currentColor"
            viewBox="0 0 24 24"
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
          {/* Overview */}
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
            <h4 className="text-(--accent) font-bold mb-3 flex items-center">
              Meta Analysis Overview
            </h4>
            <div className="text-sm text-secondary-wh40k space-y-2">
              <p className="text-primary-wh40k">
                Meta Analysis shows the most effective team compositions for
                each boss based on actual battle data:
              </p>
              <div className="ml-4 space-y-1">
                <p>
                  <span className="text-yellow-400">Damage Analysis:</span>{' '}
                  Average output, consistency, and peak performance
                </p>
                <p>
                  <span className="text-green-400">Stability Metrics:</span> How
                  reliable each team performs across battles
                </p>
                <p>
                  <span className="text-purple-400">Risk-Adjusted Scores:</span>{' '}
                  Sharpe ratio balances damage vs consistency
                </p>
                <p>
                  <span className="text-(--accent)">Team Categories:</span>{' '}
                  Automatic classification by hero composition patterns
                </p>
              </div>
            </div>
          </div>

          {/* Team Categories */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              Team Category Classifications
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-3">
                  Meta Team Categories
                </p>
                <div className="text-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-600/20 text-red-400 min-w-[80px] justify-center">
                      AdMech
                    </span>
                    <span className="text-secondary-wh40k">
                      AdMech teams with Exitor-Rho-1.15/x
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-600/20 text-purple-400 min-w-[80px] justify-center">
                      Neuro
                    </span>
                    <span className="text-secondary-wh40k">
                      Teams with Neurothrope
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-700/30 text-blue-200 min-w-[80px] justify-center">
                      Double Howl
                    </span>
                    <span className="text-secondary-wh40k">
                      Double howl buff teams with Aun&apos;shi and Ragnar
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 min-w-[80px] justify-center">
                      Orkz
                    </span>
                    <span className="text-secondary-wh40k">
                      Da Boyzzz WAAAAGGGHHHH with Snotflogga and Boss Gulgortz
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 min-w-[80px] justify-center">
                      Custodes
                    </span>
                    <span className="text-secondary-wh40k">
                      Teams with Trajann and Kariyan
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-900/30 text-white border border-card-border/30 min-w-[80px] justify-center">
                      Helbrecht
                    </span>
                    <span className="text-secondary-wh40k">
                      High Marshal Helbrecht team
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-300 min-w-[80px] justify-center">
                      Forcasmo
                    </span>
                    <span className="text-secondary-wh40k">
                      Teams with Asmodai and Forcas
                    </span>
                  </div>
                  <div className="mt-3 p-2 bg-(--bg-secondary) hover:bg-card/80 transition-colors duration-200 rounded-sm text-xs text-secondary-wh40k">
                    <strong>Match Types:</strong>
                    <br />• <span className="text-green-400">Any</span>: Teams
                    with at least one trigger hero
                    <br />• <span className="text-yellow-400">All</span>: Teams
                    requiring all specified heroes
                    <br />• <span className="text-red-400">Exact</span>: Teams
                    matching exactly the specified composition
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Metrics Explanation */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              Understanding the Metrics
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Key Performance Indicators
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p>
                    <span className="text-(--accent)">Average Damage:</span>{' '}
                    Mean output across all battles (higher = better)
                  </p>
                  <p>
                    <span className="text-green-400">Stability Score:</span>{' '}
                    Consistency percentage (80%+ = very reliable)
                  </p>
                  <p>
                    <span className="text-yellow-400">Sharpe Ratio:</span>{' '}
                    Risk-adjusted metric balancing damage vs variance
                  </p>
                  <p>
                    <span className="text-purple-400">Usage Rate:</span>{' '}
                    Popularity indicator (high usage = proven effective)
                  </p>
                  <p>
                    <span className="text-red-400">Battle Count:</span> Sample
                    size (10+ battles = statistically reliable)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Usage Tips */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              Tips for Guild Leaders
            </h4>
            <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
              <div className="text-sm text-secondary-wh40k space-y-1">
                {/* Scope copy comes from the shared contract so the page cannot drift from the real scope. */}
                <p data-testid="meta-analysis-faq-scope">
                  • {META_ANALYSIS_GLOBAL_SCOPE_NOTICE} —{' '}
                  {META_ANALYSIS_GLOBAL_SCOPE_DETAIL}. For your own guild&apos;s
                  compositions, see{' '}
                  <Link
                    href={META_ANALYSIS_MY_GUILD_HREF}
                    className="text-(--accent) underline-offset-4 hover:underline"
                  >
                    {META_ANALYSIS_MY_GUILD_LINK_LABEL}
                  </Link>
                </p>
                <p>
                  • Compare your roster against these global picks to find new
                  strategies
                </p>
                <p>• Prioritize stability for critical boss assignments</p>
                <p>• Look for underused high-performers (hidden gems)</p>
                <p>• Use team comparison to evaluate alternatives</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
