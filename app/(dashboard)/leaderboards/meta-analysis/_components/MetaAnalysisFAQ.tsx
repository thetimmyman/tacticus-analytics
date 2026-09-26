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
        className="flex items-center justify-between w-full p-3 bg-[var(--card-bg)] hover:bg-[var(--bg-tertiary)] rounded-lg border border-[var(--card-border)] transition-colors"
      >
        <h3 className="text-lg font-bold text-[var(--primary)]">
          How Meta Analysis Works
        </h3>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <svg
            className="w-5 h-5 text-[var(--text-secondary)]"
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
        <div className="space-y-6 p-4 bg-[var(--bg-secondary)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[var(--card-border)]">
          {/* Overview */}
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
            <h4 className="text-[var(--accent)] font-bold mb-3 flex items-center">
              Meta Analysis Overview
            </h4>
            <div className="text-sm text-[var(--text-secondary)] space-y-2">
              <p className="text-[var(--text-primary)]">
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
                  <span className="text-[var(--accent)]">Team Categories:</span>{' '}
                  Automatic classification by hero composition patterns
                </p>
              </div>
            </div>
          </div>

          {/* Team Categories */}
          <div>
            <h4 className="text-[var(--primary)] font-bold mb-3 flex items-center">
              Team Category Classifications
            </h4>
            <div className="space-y-3">
              <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 p-3 rounded border border-[var(--card-border)]">
                <p className="text-[var(--text-primary)] font-medium mb-3">
                  Meta Team Categories
                </p>
                <div className="text-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-600/20 text-red-400 min-w-[80px] justify-center">
                      AdMech
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      AdMech teams with Exitor-Rho-1.15/x
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-600/20 text-purple-400 min-w-[80px] justify-center">
                      Neuro
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      Teams with Neurothrope
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-700/30 text-blue-200 min-w-[80px] justify-center">
                      Double Howl
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      Double howl buff teams with Aun&apos;shi and Ragnar
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 min-w-[80px] justify-center">
                      Orkz
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      Da Boyzzz WAAAAGGGHHHH with Snotflogga and Boss Gulgortz
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 min-w-[80px] justify-center">
                      Custodes
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      Teams with Trajann and Kariyan
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-900/30 text-white border border-card-border/30 min-w-[80px] justify-center">
                      Helbrecht
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      High Marshal Helbrecht team
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-300 min-w-[80px] justify-center">
                      Forcasmo
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      Teams with Asmodai and Forcas
                    </span>
                  </div>
                  <div className="mt-3 p-2 bg-[var(--bg-secondary)] hover:bg-card/80 transition-colors duration-200 rounded text-xs text-[var(--text-secondary)]">
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
            <h4 className="text-[var(--primary)] font-bold mb-3 flex items-center">
              Understanding the Metrics
            </h4>
            <div className="space-y-3">
              <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 p-3 rounded border border-[var(--card-border)]">
                <p className="text-[var(--text-primary)] font-medium mb-2">
                  Key Performance Indicators
                </p>
                <div className="text-sm text-[var(--text-secondary)] ml-4 space-y-1">
                  <p>
                    <span className="text-[var(--accent)]">
                      Average Damage:
                    </span>{' '}
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
            <h4 className="text-[var(--primary)] font-bold mb-3 flex items-center">
              Tips for Guild Leaders
            </h4>
            <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 p-3 rounded border border-[var(--card-border)]">
              <div className="text-sm text-[var(--text-secondary)] space-y-1">
                {/* Scope copy comes from the shared contract so the page cannot drift from the real scope. */}
                <p data-testid="meta-analysis-faq-scope">
                  • {META_ANALYSIS_GLOBAL_SCOPE_NOTICE} —{' '}
                  {META_ANALYSIS_GLOBAL_SCOPE_DETAIL}. For your own guild&apos;s
                  compositions, see{' '}
                  <Link
                    href={META_ANALYSIS_MY_GUILD_HREF}
                    className="text-[var(--accent)] underline-offset-4 hover:underline"
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
