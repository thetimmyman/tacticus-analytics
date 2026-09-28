'use client'

import { useState, memo } from 'react'
import { StatusLabel } from '@tacticus/ui-kit'
import { isFeatureEnabled } from '@/app/lib/config/features'

interface VOTLWCalculationsFAQProps {
  offenderThreshold?: number
  tokenFilteringEnabled?: boolean
}

const strictTokenModeEnabled = isFeatureEnabled('VOTLW_STRICT_TOKENS')

function VOTLWCalculationsFAQ({
  offenderThreshold = 4,
  tokenFilteringEnabled = false
}: VOTLWCalculationsFAQProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-3 bg-(--card-bg) hover:bg-(--bg-tertiary) rounded-lg border border-(--card-border) transition-colors"
      >
        <h3 className="text-lg font-bold text-(--primary)">
          📊 How VOTLW Works - Detailed Calculations
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
          <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <StatusLabel
                type={tokenFilteringEnabled ? 'success' : 'warning'}
                size="xs"
              >
                Token Offender Filtering:{' '}
                {tokenFilteringEnabled ? 'Enabled' : 'Disabled'}
              </StatusLabel>
              <StatusLabel
                type={strictTokenModeEnabled ? 'error' : 'info'}
                size="xs"
              >
                Strict Token Awards:{' '}
                {strictTokenModeEnabled ? 'Enforced' : 'Relaxed'}
              </StatusLabel>
            </div>
            <p className="text-sm text-secondary-wh40k leading-relaxed">
              {tokenFilteringEnabled
                ? strictTokenModeEnabled
                  ? 'Players who miss ' +
                    offenderThreshold +
                    '+ tokens are excluded from medal math, set winners, and seasonal awards.'
                  : 'We still calculate and display token offenders for auditing, but they remain eligible for medals so data stays transparent.'
                : 'All members are considered for medals and awards regardless of token usage, which can help during backfills or onboarding seasons.'}
            </p>
            <p className="text-xs text-(--text-tertiary)">
              Token offender filtering is controlled per-guild by officers and
              leaders in the VOTLW Award Controls panel below. Strict token
              awards are still controlled via{' '}
              <code className="font-mono text-(--accent)">
                NEXT_PUBLIC_VOTLW_STRICT_TOKENS
              </code>
              .
            </p>
          </div>

          {/* Point System Overview */}
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
            <h4 className="text-(--accent) font-bold mb-3 flex items-center">
              <span className="mr-2">🏆</span>
              VOTLW Point System Overview
            </h4>
            <div className="text-sm text-secondary-wh40k space-y-2">
              <p className="text-primary-wh40k">
                The <span className="font-bold">Veteran of the Long War</span>{' '}
                is determined by totaling points across all categories:
              </p>
              <div className="ml-4 space-y-1">
                <p>
                  <span className="text-yellow-400">🥇 Gold Medals:</span> 3
                  points each (highest avg damage per boss, 2+ battles required)
                </p>
                <p>
                  <span className="text-gray-300">🥈 Silver Medals:</span> 2
                  points each (second highest avg damage)
                </p>
                <p>
                  <span className="text-orange-600">🥉 Bronze Medals:</span> 1
                  point each (third highest avg damage)
                </p>
                <p>
                  <span className="text-red-400">💥 Most Damage Awards:</span> 1
                  point each (highest total damage per boss)
                </p>
                <p>
                  <span className="text-purple-400">👹 Side Boss Wins:</span> 2
                  points each (avg damage on prime bosses)
                </p>
                <p>
                  <span className="text-blue-400">🎯 Biggest Hit Awards:</span>{' '}
                  1 point each (highest single hit per boss)
                </p>
                <p>
                  <span className="text-green-400">💀 Top Killer:</span> 3
                  points (most last hits across all bosses)
                </p>
                <p>
                  <span className="text-orange-300">💣 Best Bomber:</span> 0.5
                  points (highest single bomb damage)
                </p>
              </div>
            </div>
          </div>

          {/* Which bosses carry awards */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              <span className="mr-2">🔁</span>
              Which Bosses Carry Awards
            </h4>
            <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
              <div className="text-sm text-secondary-wh40k space-y-1">
                <p>
                  • Awards cover the bosses the season{' '}
                  <span className="text-(--accent)">loops</span> — the ones the
                  raid replays after the first pass
                </p>
                <p>
                  • From Season 107 the loop restarts at{' '}
                  <span className="text-(--primary)">L4</span>, so L1–L3 are
                  played once and carry no medals, most damage, side bosses or
                  biggest hit
                </p>
                <p>
                  • Earlier seasons looped from L1 and keep every award — past
                  results are unchanged
                </p>
                <p className="text-xs italic pt-1">
                  This is read from what the season actually played, not
                  hardcoded: if the game moves the loop again, the awards
                  follow. Top Killer and Best Bomber still count every boss.
                </p>
              </div>
            </div>
          </div>

          {/* Medal Calculation Details */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              <span className="mr-2">🥇</span>
              Medal Calculations (Gold/Silver/Bronze)
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 1: Average Damage Per Token
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-yellow-900/30 p-2 rounded-sm">
                    Player Average = (Total Damage to Boss) ÷ (Number of Tokens
                    Used)
                  </p>
                  <p>
                    <span className="text-yellow-400">Example:</span> Player
                    deals 50M + 45M + 55M = 150M damage over 3 tokens
                  </p>
                  <p className="ml-4">
                    → Average = 150M ÷ 3 ={' '}
                    <span className="text-(--accent)">50M per token</span>
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 2: Qualification Requirements
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p>
                    • <span className="text-(--accent)">Minimum 2 battles</span>{' '}
                    per boss to qualify for medals
                  </p>
                  {tokenFilteringEnabled && (
                    <p>
                      •{' '}
                      <span className="text-(--accent)">
                        Token offenders automatically excluded
                      </span>{' '}
                      (missing {offenderThreshold}+ tokens)
                    </p>
                  )}
                  <p>
                    • Only{' '}
                    <span className="text-(--primary)">main boss battles</span>{' '}
                    count (encounterId = 0)
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Which battles count toward your average?
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p>
                    • <span className="text-(--accent)">Sweeps</span> (finishing
                    blows on an already-damaged boss) are excluded — unless the
                    sweep&apos;s damage beats BOTH your own average and the
                    guild average for that boss, in which case it counts fully
                    (battle and damage).
                  </p>
                  <p>
                    • <span className="text-(--accent)">One-shots</span>{' '}
                    (killing the boss from full HP) always count.
                  </p>
                  <p>
                    • <span className="text-(--accent)">Crashes</span> (0
                    damage) never count.
                  </p>
                  <p className="text-yellow-400 text-xs">
                    Boss Performance pages show raw damage averages over all
                    tokens, so the numbers there can differ from award values —
                    the award math above is the source of truth for medals.
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Step 3: Tie-Breaking System
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p>
                    <span className="text-(--accent)">1st Tie-Breaker:</span>{' '}
                    More tokens spent (shows consistency)
                  </p>
                  <p>
                    <span className="text-(--accent)">2nd Tie-Breaker:</span>{' '}
                    Earlier first token (shows proactiveness)
                  </p>
                  <p className="text-yellow-400 text-xs">
                    If Player A and B both average 50M, but A used 5 tokens vs
                    B&apos;s 3, Player A wins
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Side Boss Calculations */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              <span className="mr-2">👹</span>
              Side Boss Winner Algorithm
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Prime Boss Performance Formula
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-purple-900/30 p-2 rounded-sm">
                    Side Boss Score = Σ(damage_per_token) for encounter_1 or
                    encounter_2
                  </p>
                  <p>
                    <span className="text-yellow-400">Example:</span> L1 Side
                    Boss 1 (encounterId &gt; 0, encounterIndex = 1)
                  </p>
                  <p className="ml-4">
                    → Player hits: 35M, 40M, 30M = 105M ÷ 3 ={' '}
                    <span className="text-(--accent)">35M average</span>
                  </p>
                  <p className="text-purple-400 text-xs">
                    Separate awards for Side Boss 1 and Side Boss 2 of each
                    level
                  </p>
                  <p>
                    •{' '}
                    <span className="text-(--accent)">
                      Minimum 2 counted battles
                    </span>{' '}
                    per side boss to win (same rule as main-boss medals) — if
                    nobody qualifies, the award has no winner
                  </p>
                  <p>
                    • The same sweep / one-shot / crash rules as main-boss
                    medals apply, so a side-boss award value can differ from the
                    raw average shown on Boss Performance cards (which include
                    sweeps)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Season Awards */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              <span className="mr-2">🌟</span>
              Season-Wide Award Calculations
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Top Killer Algorithm
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-red-900/30 p-2 rounded-sm">
                    Kills = COUNT(battles WHERE remainingHp = 0 AND damageType =
                    &apos;Battle&apos;)
                  </p>
                  <p>
                    <span className="text-green-400">Counts:</span> Last hits
                    that finish off bosses (remainingHp = 0)
                  </p>
                  <p>
                    <span className="text-red-400">Excludes:</span> Bomb kills
                    {tokenFilteringEnabled ? ', token offenders' : ''}
                  </p>
                  <p className="text-yellow-400 text-xs">
                    Tie-breaker: Player who got the earliest kill in the season
                    wins
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Best Bomber Calculation
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-orange-900/30 p-2 rounded-sm">
                    Best Bomb = MAX(damageDealt WHERE damageType =
                    &apos;Bomb&apos;)
                  </p>
                  <p>
                    Simply the{' '}
                    <span className="text-(--accent)">
                      highest single bomb damage
                    </span>{' '}
                    in the season
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Battlefield Honors */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              <span className="mr-2">🎖️</span>
              Battlefield Honors Breakdown
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Melta Malfunction (Worst Bomb)
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-amber-900/30 p-2 rounded-sm">
                    Worst Bomb = MIN(damageDealt WHERE damageType =
                    &apos;Bomb&apos; AND damageDealt &gt; 0)
                  </p>
                  <p>
                    Picks the{' '}
                    <span className="text-(--accent)">
                      smallest non-zero bomb
                    </span>{' '}
                    of the season{' '}
                    {tokenFilteringEnabled
                      ? 'after filtering out token offenders.'
                      : 'without filtering out token offenders.'}
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  So Close... (Almost Had Him)
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-indigo-900/30 p-2 rounded-sm">
                    Closest Miss = MIN(remainingHp WHERE remainingHp &gt; 0)
                  </p>
                  <p>
                    Looks across every battle that{' '}
                    <span className="text-(--accent)">
                      failed to finish the boss
                    </span>
                    {tokenFilteringEnabled ? ', skips offenders,' : ','} and
                    highlights the attempt that left the least HP behind.
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Rising Star (Most Improved)
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-emerald-900/30 p-2 rounded-sm">
                    Improvement % = ((current_avg - previous_avg) ÷
                    previous_avg) × 100
                  </p>
                  <p>
                    Compares each player&apos;s{' '}
                    <span className="text-(--accent)">
                      battle damage per token vs the prior season
                    </span>{' '}
                    (same guild & cluster) and rewards the largest positive
                    gain.
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Lightning Strike (First Token)
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-cyan-900/30 p-2 rounded-sm">
                    Earliest Token = MIN(startedOn OR completedOn)
                  </p>
                  <p>
                    Finds the{' '}
                    <span className="text-(--accent)">
                      first recorded battle timestamp
                    </span>{' '}
                    of the season (battle or bomb) to salute the fastest
                    responder.
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Iron Resolve (Last Token)
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-fuchsia-900/30 p-2 rounded-sm">
                    Latest Token = MAX(startedOn OR completedOn)
                  </p>
                  <p>
                    Rewards the player who{' '}
                    <span className="text-(--accent)">closed the campaign</span>{' '}
                    with the season&apos;s final recorded battle timestamp.
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Machine Spirit (Token Efficiency)
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-yellow-900/30 p-2 rounded-sm">
                    Damage per Token = ROUND(total_damage ÷ total_tokens)
                  </p>
                  <p>
                    Aggregates each player&apos;s{' '}
                    <span className="text-(--accent)">
                      season damage output
                    </span>
                    , divides by tokens spent
                    {tokenFilteringEnabled
                      ? ', filters out offenders,'
                      : ','}{' '}
                    then crowns the highest ratio.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Final Winner Determination */}
          <div>
            <h4 className="text-(--primary) font-bold mb-3 flex items-center">
              <span className="mr-2">🏆</span>
              VOTLW Winner Final Algorithm
            </h4>
            <div className="space-y-3">
              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Points Aggregation
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p className="font-mono bg-green-900/30 p-2 rounded-sm">
                    total_points = Σ(gold_medals × 3) + Σ(silver_medals × 2) +
                    Σ(bronze_medals × 1)
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+
                    Σ(most_damage × 1) + Σ(side_boss_wins × 2)
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+
                    Σ(biggest_hits × 1) + top_killer_bonus + bomber_bonus
                  </p>
                </div>
              </div>

              <div className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 p-3 rounded-sm border border-(--card-border)">
                <p className="text-primary-wh40k font-medium mb-2">
                  Tie-Breaking Priority
                </p>
                <div className="text-sm text-secondary-wh40k ml-4 space-y-1">
                  <p>
                    <span className="text-(--accent)">1st:</span> Total points
                    (higher wins)
                  </p>
                  <p>
                    <span className="text-(--accent)">2nd:</span> Total tokens
                    spent (more wins - shows participation)
                  </p>
                  <p>
                    <span className="text-(--accent)">3rd:</span> First token
                    timestamp (earlier wins - shows proactiveness)
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

export default memo(VOTLWCalculationsFAQ)
