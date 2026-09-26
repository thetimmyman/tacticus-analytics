'use client'

import { useState } from 'react'

export function BossLeaderboardsCalculationsFAQ() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full p-3 bg-[var(--card-bg)] hover:bg-[var(--bg-tertiary)] rounded-lg border border-[var(--card-border)] transition-colors"
      >
        <h3 className="text-lg font-bold text-[var(--primary)]">
          How Boss Leaderboards Work - Detailed Calculations
        </h3>
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          <svg
            className="w-5 h-5 text-[var(--text-secondary)]"
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
        <div className="space-y-6 p-4 bg-[var(--bg-secondary)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[var(--card-border)]">
          <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-4">
            <h4 className="text-[var(--accent)] font-bold mb-3 flex items-center">
              Boss Leaderboards Overview
            </h4>
            <div className="text-sm text-[var(--text-secondary)] space-y-2">
              <p className="text-[var(--text-primary)]">
                Boss Leaderboards highlight{' '}
                <span className="font-bold">maximum damage potential</span>{' '}
                against specific boss encounters:
              </p>
              <div className="ml-4 space-y-1">
                <p>
                  <span className="text-red-400">Peak Performance:</span>{' '}
                  Highest single hits achieved per boss encounter
                </p>
                <p>
                  <span className="text-blue-400">Team Composition:</span> Exact
                  hero/Machine of War combinations for each record
                </p>
                <p>
                  <span className="text-purple-400">Deduplication:</span> One
                  record per player/team combination to encourage diversity
                </p>
                <p>
                  <span className="text-[var(--primary)]">
                    Multi-Boss Tracking:
                  </span>{' '}
                  Separate leaderboards for main bosses and prime encounters
                </p>
                <p>
                  <span className="text-[var(--accent)]">
                    Historical Context:
                  </span>{' '}
                  Date, loop, and level information for each record
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-[var(--primary)] font-bold mb-3 flex items-center">
              Record Deduplication Algorithm
            </h4>
            <div className="space-y-3">
              <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 p-3 rounded border border-[var(--card-border)]">
                <p className="text-[var(--text-primary)] font-medium mb-2">
                  Team Composition Fingerprinting
                </p>
                <div className="text-sm text-[var(--text-secondary)] ml-4 space-y-1">
                  <p className="font-mono bg-purple-900/30 p-2 rounded">
                    Team_Key = CONCAT(sorted_hero_ids) + &quot;_&quot; +
                    machine_of_war_id
                    <br />
                    Record_Key = player_name + &quot;_&quot; + boss_name +
                    &quot;_&quot; + encounter_id + &quot;_&quot; + team_key
                  </p>
                  <p>
                    <span className="text-yellow-400">Purpose:</span> Ensures
                    each unique player/boss/team combination gets one record
                  </p>
                  <p className="ml-4">
                    → Same team composition ={' '}
                    <span className="text-[var(--accent)]">
                      overwrites previous record
                    </span>
                  </p>
                  <p>
                    <span className="text-purple-400">Hero Sorting:</span>{' '}
                    Heroes sorted by unitId to handle ordering variations
                  </p>
                </div>
              </div>

              <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 p-3 rounded border border-[var(--card-border)]">
                <p className="text-[var(--text-primary)] font-medium mb-2">
                  Maximum Damage Selection
                </p>
                <div className="text-sm text-[var(--text-secondary)] ml-4 space-y-1">
                  <p className="font-mono bg-red-900/30 p-2 rounded">
                    IF new_damage &gt; existing_record.damage THEN
                    <br />
                    &nbsp;&nbsp;UPDATE record SET damage = new_damage, date =
                    new_date
                    <br />
                    ELSE IGNORE new_record
                  </p>
                  <p>
                    <span className="text-green-400">Benefit:</span> Encourages
                    optimization of specific team compositions
                  </p>
                  <p>
                    <span className="text-yellow-400">Strategy:</span> Players
                    can experiment with different teams for multiple leaderboard
                    spots
                  </p>
                </div>
              </div>

              <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 p-3 rounded border border-[var(--card-border)]">
                <p className="text-[var(--text-primary)] font-medium mb-2">
                  Average Damage Calculation
                </p>
                <div className="text-sm text-[var(--text-secondary)] ml-4 space-y-1">
                  <p>
                    Avg Damage is per player (across all their teams) and uses
                    the same rules as the rest of the app:
                  </p>
                  <p className="ml-4">
                    → Battle attacks only — bombs and zero-damage crashes never
                    count
                  </p>
                  <p className="ml-4">
                    → Sweeps (killing blows on an already-damaged boss) are
                    excluded, <span className="text-green-400">unless</span> the
                    sweep&apos;s damage beats both the player&apos;s own average
                    and the cluster/guild average — then it counts
                  </p>
                  <p className="ml-4">
                    → One-shot kills (full boss HP in a single attack) always
                    count
                  </p>
                  <p>
                    The <span className="text-yellow-400">battles</span> shown
                    under each average is the number of attacks counted in it.
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
