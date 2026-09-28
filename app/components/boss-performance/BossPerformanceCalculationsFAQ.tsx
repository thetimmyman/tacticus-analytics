'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

type FaqSection = {
  title: string
  content: ReactNode
}

const SECTIONS: FaqSection[] = [
  {
    title: 'Boss Performance Overview',
    content: (
      <>
        <p>
          Boss Performance shows how every player contributes to raid
          encounters. The dashboard merges efficiency metrics, token usage, and
          loop pacing so leaders immediately spot the targets that need coaching
          or roster changes.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-semibold text-primary-wh40k">
              Average Damage Rankings:
            </span>{' '}
            Player efficiency per token spent.
          </li>
          <li>
            <span className="font-semibold text-primary-wh40k">
              Total Damage Rankings:
            </span>{' '}
            Overall contribution across the season.
          </li>
          <li>
            <span className="font-semibold text-primary-wh40k">
              Prime Boss Performance:
            </span>{' '}
            Identifies specialists on side bosses.
          </li>
          <li>
            <span className="font-semibold text-primary-wh40k">
              Loop Trend Analysis:
            </span>{' '}
            Flags degradation or improvements across raid loops.
          </li>
          <li>
            <span className="font-semibold text-primary-wh40k">
              Statistical Tracking:
            </span>{' '}
            Surfaces max hits, efficiency ratios, and participation rates.
          </li>
        </ul>
      </>
    )
  },
  {
    title: 'Player Average Damage Rankings',
    content: (
      <div className="space-y-3">
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Step 1: Average Damage Calculation
          </h5>
          <div className="mt-1 rounded-sm bg-card/60 p-3 font-mono text-xs">
            Player_Avg_Damage = Σ(non_sweep_damage) ÷ COUNT(non_sweep_tokens)
          </div>
          <p className="mt-2">
            Example: Hits of 45M, 52M, 48M ⇒ (45 + 52 + 48) ÷ 3 ={' '}
            <span className="font-semibold text-(--primary)">48.33M</span> per
            token.
          </p>
          <p className="text-xs text-secondary-wh40k">
            Finishing blows (remainingHp = 0) are excluded for main bosses so
            clean-up hits do not inflate averages.
          </p>
        </div>
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Step 2: Data Filtering Rules
          </h5>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              Main boss only: <code className="font-mono">encounterId = 0</code>{' '}
              (prime bosses excluded).
            </li>
            <li>
              No finishing blows: require{' '}
              <code className="font-mono">remainingHp &gt; 0</code>.
            </li>
            <li>
              Battle damage only:{' '}
              <code className="font-mono">damageType = &apos;Battle&apos;</code>{' '}
              (bombs/utilities removed).
            </li>
            <li>
              Positive damage: ignore{' '}
              <code className="font-mono">damageDealt ≤ 0</code>.
            </li>
          </ul>
        </div>
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Step 3: Ranking &amp; Visualization
          </h5>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Players ranked by average damage (highest first).</li>
            <li>Progress bar width = (player_avg ÷ player_max_hit) × 100%.</li>
            <li>
              Leaderboard paginated to 10 players per page for responsiveness.
            </li>
            <li>Wider bars signal steadier output across the season.</li>
          </ul>
        </div>
      </div>
    )
  },
  {
    title: 'Total Damage Output Rankings',
    content: (
      <div className="space-y-3">
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Cumulative Contribution Algorithm
          </h5>
          <div className="mt-1 rounded-sm bg-card/60 p-3 font-mono text-xs">
            Total_Damage = Σ(all_battle_damage_to_main_boss)
          </div>
          <p className="mt-2">
            Highlights heavy lifters who may have average hits below the top
            players but consistently burn tokens for the guild.
          </p>
        </div>
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Progress Bar Calculation
          </h5>
          <div className="mt-1 rounded-sm bg-card/60 p-3 font-mono text-xs">
            Bar_Width = (player_total_damage ÷ max_total_damage) × 100%
          </div>
          <p className="mt-2">
            Visual scale is relative to the top damage dealer, so you instantly
            see how far behind other players are.
          </p>
        </div>
      </div>
    )
  },
  {
    title: 'Loop Trend Analysis Algorithm',
    content: (
      <div className="space-y-3">
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Loop-by-Loop Performance Tracking
          </h5>
          <div className="mt-1 rounded-sm bg-card/60 p-3 font-mono text-xs">
            Loop_N_Avg = Σ(non_sweep_damage_in_loop_N) ÷
            COUNT(non_sweep_tokens_in_loop_N)
            <br />
            Loop_N_Tokens = COUNT(all_battle_tokens_including_sweeps)
          </div>
          <p className="mt-2">
            Example: Loop 1 = fifteen non-sweep hits averaging 50M plus three
            sweep hits ⇒ Avg Damage = 50M, Token Count = 18 total.
          </p>
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Trend badges: improving (&lt; -10%), declining (&gt; 10%), otherwise
            stable.
          </li>
          <li>
            Average and last-loop time-to-kill come from{' '}
            <code className="font-mono">boss_difficulty_analysis</code>.
          </li>
          <li>
            Damage-per-hour reveals slow clears even when raw averages look
            fine.
          </li>
        </ul>
      </div>
    )
  },
  {
    title: 'Prime Boss Performance Analysis',
    content: (
      <div className="space-y-3">
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Individual Side Boss Tracking
          </h5>
          <div className="mt-1 rounded-sm bg-card/60 p-3 font-mono text-xs">
            Prime_Avg = Σ(damage_to_specific_prime) ÷
            COUNT(tokens_to_specific_prime)
            <br />
            WHERE encounterId &gt; 0 AND Name = &apos;specific_prime&apos;
          </div>
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Each prime boss is ranked independently; one-shot kills remain
            included (finishing blows allowed).
          </li>
          <li>
            Top 10 display uses a purple theme to distinguish from the main boss
            rankings.
          </li>
          <li>
            Tokens used and max hits display alongside damage to highlight
            efficiency.
          </li>
        </ul>
      </div>
    )
  },
  {
    title: 'Top Statistics Calculations',
    content: (
      <div className="space-y-3">
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Summary Statistics Algorithm
          </h5>
          <div className="mt-1 rounded-sm bg-card/60 p-3 font-mono text-xs">
            Top_Total_Damage = MAX(player_total_damage)
            <br />
            Biggest_Hit = MAX(single_battle_damage)
            <br />
            Overall_Avg = Σ(all_non_sweep_damage) ÷ COUNT(all_non_sweep_battles)
            <br />
            Total_Tokens = COUNT(all_battle_entries_including_sweeps)
          </div>
        </div>
        <div>
          <h5 className="text-primary-wh40k font-semibold">
            Token Counting Rules
          </h5>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              Main boss tokens:{' '}
              <code className="font-mono">encounterId = 0</code>,{' '}
              <code className="font-mono">damageType = &apos;Battle&apos;</code>
              .
            </li>
            <li>
              Prime tokens:{' '}
              <code className="font-mono">encounterId &gt; 0</code>,{' '}
              <code className="font-mono">damageType = &apos;Battle&apos;</code>
              .
            </li>
            <li>
              Sweeps count toward total tokens but never toward damage averages.
            </li>
          </ul>
        </div>
      </div>
    )
  }
]

export function BossPerformanceCalculationsFAQ() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-lg border border-(--card-border) bg-(--card-bg) px-3 py-2 text-left transition-colors hover:bg-(--bg-tertiary)"
      >
        <h3 className="text-lg font-semibold text-(--primary)">
          How boss performance calculations work
        </h3>
        <span
          aria-hidden="true"
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <svg
            className="h-5 w-5 text-secondary-wh40k"
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
        <div className="space-y-6 rounded-lg border border-(--card-border) bg-(--bg-secondary) p-4">
          {SECTIONS.map((section) => (
            <article
              key={section.title}
              className="space-y-3 rounded-md border border-(--card-border) bg-(--card-bg) p-3"
            >
              <div className="flex items-center gap-2">
                <h4 className="text-base font-semibold text-(--primary)">
                  {section.title}
                </h4>
              </div>
              <div className="space-y-2 text-sm text-secondary-wh40k">
                {section.content}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
