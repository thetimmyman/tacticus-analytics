'use client'

import { useState, memo } from 'react'

function TokenUsageCalculationsFAQ() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="card-wh40k p-4 sm:p-6 mt-6">
      <div className="space-y-4 sm:space-y-6">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full text-left group py-2 sm:py-0 min-h-[44px] sm:min-h-0"
        >
          <h3 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors pr-2">
            How Token Usage Calculations Work
          </h3>
          <div
            className={`transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          >
            <svg
              className="w-6 h-6 sm:w-5 sm:h-5 text-[var(--text-secondary)]"
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
        </button>

        {isOpen && (
          <div className="space-y-4 sm:space-y-6 pt-4 border-t border-[var(--card-border)]">
            <FAQSection
              title="Summary Statistics - Calculation Methods"
              items={[
                {
                  label: 'Total Tokens:',
                  description: 'Guild-wide token count calculation:',
                  details: [
                    {
                      key: 'Data Source',
                      value:
                        "All battles where damageType = 'Battle' for selected guild and season"
                    },
                    {
                      key: 'Calculation',
                      value:
                        'Count of all battle records (1 token = 1 battle, includes sweeps)'
                    },
                    {
                      key: 'Exclusions',
                      value: 'Only bomb usage does not count as tokens'
                    }
                  ]
                },
                {
                  label: 'Average Usage:',
                  description: 'Mean tokens per player:',
                  details: [
                    { key: 'Formula', value: 'Total Tokens ÷ Active Players' },
                    {
                      key: 'Active Players',
                      value: 'Guild members with at least 1 battle this season'
                    }
                  ]
                },
                {
                  label: '5-Season Veterans:',
                  description: 'Historical participation requirement:',
                  details: [
                    {
                      key: 'Criteria',
                      value:
                        'Must have battles in all of the past 5 completed seasons'
                    },
                    {
                      key: 'Purpose',
                      value:
                        'Identifies long-term active players for trend analysis'
                    }
                  ]
                }
              ]}
            />

            <FAQSection
              title="Player Token Charts - Visual Calculations"
              items={[
                {
                  label: 'Vertical Bar Heights:',
                  description: 'Proportional scaling algorithm:',
                  details: [
                    {
                      key: 'Scale Calculation',
                      value:
                        'Bar Height % = (Player Tokens ÷ Max Player Tokens) × 100'
                    },
                    {
                      key: 'Minimum Height',
                      value: '12px minimum for visibility when tokens > 0'
                    },
                    {
                      key: 'Sorting',
                      value:
                        'Players ranked by selected sort criteria (Total, Efficiency, etc.)'
                    }
                  ]
                },
                {
                  label: 'Rarity Stacking:',
                  description:
                    'Proportional rarity distribution within each bar:',
                  details: [
                    {
                      key: 'Segment Height',
                      value: '(Rarity Tokens ÷ Player Total) × Bar Height'
                    },
                    {
                      key: 'Color Coding',
                      value:
                        'Common (gray) → Mythic (purple) with distinct rarity colors'
                    },
                    {
                      key: 'Stacking Order',
                      value: 'Common (bottom) to Mythic (top)'
                    }
                  ]
                },
                {
                  label: 'Boss vs Prime Token Breakdown:',
                  description: 'Encounter type classification:',
                  details: [
                    {
                      key: 'Boss Tokens',
                      value:
                        'Battles where encounterId = 0 (main boss encounters)'
                    },
                    {
                      key: 'Prime Tokens',
                      value:
                        'Battles where encounterId > 0 (special prime encounters)'
                    },
                    {
                      key: 'Total',
                      value:
                        'Boss Tokens + Prime Tokens = Total Tokens for each player'
                    }
                  ]
                }
              ]}
            />

            <FAQSection
              title="Historical Analysis - 5-Season Trends"
              items={[
                {
                  label: 'Historical Average Calculation:',
                  description: 'Multi-season token analysis:',
                  details: [
                    {
                      key: 'Data Range',
                      value:
                        'Past 5 completed seasons (excludes current season)'
                    },
                    {
                      key: 'Eligibility',
                      value: 'Player must have participated in ALL 5 seasons'
                    },
                    {
                      key: 'Formula',
                      value: 'Historical Avg = Σ(Season Tokens) ÷ 5 seasons'
                    },
                    {
                      key: 'Sorting',
                      value:
                        'Historical chart sorted by historical average (highest first)'
                    }
                  ]
                },
                {
                  label: 'Current vs Historical Comparison:',
                  description: 'Performance delta analysis:',
                  details: [
                    {
                      key: 'Calculation',
                      value: '((Current Tokens ÷ Historical Avg) - 1) × 100'
                    },
                    {
                      key: 'Display',
                      value:
                        'Shows current tokens with percentage change from historical average'
                    }
                  ],
                  example: 'Historical avg 25, current 30 → +20% increase'
                }
              ]}
            />

            <FAQSection
              title="Boss Token Distribution - Guild Strategy Analysis"
              items={[
                {
                  label: 'Distribution Calculation:',
                  description: 'Guild-wide token allocation analysis:',
                  details: [
                    {
                      key: 'Boss Grouping',
                      value:
                        'Individual boss names for main encounters (encounterId = 0)'
                    },
                    {
                      key: 'Prime Grouping',
                      value:
                        "All prime encounters grouped as 'Primes' (encounterId > 0)"
                    },
                    {
                      key: 'Percentage',
                      value: '(Boss Tokens ÷ Total Guild Tokens) × 100'
                    }
                  ]
                },
                {
                  label: 'Pie Chart Visualization:',
                  description: 'Proportional boss focus:',
                  details: [
                    {
                      key: 'Segment Size',
                      value: 'Proportional to percentage of total tokens spent'
                    },
                    {
                      key: 'Color Coding',
                      value: 'Theme-aware boss distribution colors'
                    }
                  ]
                }
              ]}
            />

            <FAQSection
              title="Player Efficiency & Sorting Metrics"
              items={[
                {
                  label: 'Token Efficiency:',
                  description: 'Damage output per token spent:',
                  details: [
                    {
                      key: 'Formula',
                      value: 'Efficiency = Total Damage ÷ Total Tokens'
                    },
                    {
                      key: 'Purpose',
                      value: 'Measures damage effectiveness per token used'
                    }
                  ],
                  example: '10M damage ÷ 25 tokens = 400k efficiency'
                },
                {
                  label: 'Average Tokens per Loop:',
                  description: 'Participation consistency metric:',
                  details: [
                    {
                      key: 'Calculation',
                      value:
                        'Total Tokens ÷ Number of Unique Loops Participated'
                    },
                    {
                      key: 'Loop Tracking',
                      value: 'Based on loopIndex field from battle data'
                    },
                    {
                      key: 'Insight',
                      value:
                        'Shows how evenly tokens are distributed across loops'
                    }
                  ]
                },
                {
                  label: 'Sorting Options:',
                  description: 'Multiple ranking algorithms:',
                  details: [
                    {
                      key: 'Total',
                      value: 'Sort by total tokens (highest first)'
                    },
                    {
                      key: 'Efficiency',
                      value:
                        'Sort by damage per token (highest efficiency first)'
                    },
                    {
                      key: 'Avg Per Loop',
                      value:
                        'Sort by tokens per loop (most consistent participation)'
                    },
                    {
                      key: 'Historical',
                      value: 'Sort by 5-season average (veteran performance)'
                    }
                  ]
                }
              ]}
            />

            <FAQSection
              title="Token Usage Categories & Breakdowns"
              items={[
                {
                  label: 'Usage Tier Classification:',
                  description: 'Player activity levels:',
                  details: [
                    {
                      key: '28+ tokens',
                      value:
                        'High activity players (theoretical maximum ~29 tokens/season)',
                      color: 'text-green-400'
                    },
                    {
                      key: '20-27 tokens',
                      value:
                        'Moderate activity players (regular participation)',
                      color: 'text-yellow-400'
                    },
                    {
                      key: '<20 tokens',
                      value: 'Low activity players (irregular participation)',
                      color: 'text-red-400'
                    },
                    {
                      key: 'Calculation',
                      value: 'Simple count of players in each range'
                    }
                  ]
                },
                {
                  label: 'Rarity Distribution Analysis:',
                  description: 'Battle difficulty breakdown:',
                  details: [
                    {
                      key: 'Rarity Source',
                      value:
                        "From battle data 'rarity' field (Common, Uncommon, Rare, Epic, Legendary, Mythic)"
                    },
                    {
                      key: 'Guild Summary',
                      value: 'Σ(all player rarity tokens) by type'
                    },
                    {
                      key: 'Percentage',
                      value: '(Rarity Tokens ÷ Total Guild Tokens) × 100'
                    }
                  ]
                }
              ]}
            />

            <FAQSection
              title="Credits & Attribution"
              items={[
                {
                  label: 'GR Availability Tracker:',
                  description: 'Special thanks to Djaff for creating Homina',
                  details: [
                    { key: 'Creator', value: 'Djaff (Homina Discord Bot)' },
                    {
                      key: 'GitHub',
                      value: 'https://github.com/sigubrat/Homina',
                      isLink: true
                    },
                    {
                      key: 'Integration',
                      value:
                        "GR Availability component inspired by Homina's tracking functionality"
                    }
                  ],
                  note: "The GR Availability tool shown on this page is based on concepts from Djaff's excellent Homina bot"
                }
              ]}
            />
          </div>
        )}
      </div>
    </div>
  )
}

interface FAQSectionProps {
  title: string
  items: Array<{
    label: string
    description: string
    details: Array<{
      key: string
      value: string
      color?: string
      isLink?: boolean
    }>
    example?: string
    note?: string
  }>
}

function FAQSection({ title, items }: FAQSectionProps) {
  return (
    <div className="space-y-2 sm:space-y-3">
      <h4 className="text-base sm:text-lg font-semibold text-[var(--accent)] flex items-center">
        <span className="w-2 h-2 bg-[var(--accent)] rounded-full mr-2 flex-shrink-0"></span>
        {title}
      </h4>
      <div className="pl-2 sm:pl-4 space-y-2 text-xs sm:text-sm text-[var(--text-secondary)]">
        {items.map((item) => (
          <div key={item.label}>
            <div className="leading-relaxed">
              <strong className="text-[var(--text-primary)]">
                {item.label}
              </strong>{' '}
              {item.description}
            </div>
            <div className="pl-4 space-y-1 text-xs">
              {item.details.map((detail) => (
                <div key={detail.key}>
                  <strong className={detail.color || 'text-yellow-400'}>
                    {detail.key}:
                  </strong>{' '}
                  {detail.isLink ? (
                    <a
                      href={detail.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      {detail.value}
                    </a>
                  ) : (
                    detail.value
                  )}
                </div>
              ))}
              {item.example && (
                <div className="text-green-400 mt-1">
                  <strong>Example:</strong> {item.example}
                </div>
              )}
              {item.note && (
                <div className="text-green-400 mt-1">{item.note}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(TokenUsageCalculationsFAQ)
