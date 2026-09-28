import { Metadata } from 'next'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { FAQSchema } from '@/app/components/SEO/FAQSchema'
import { Breadcrumbs } from '@/app/components/navigation/Breadcrumbs'
import { TACTICUS_API } from '@tacticus/app-core/app-config'

export const metadata: Metadata = {
  title: 'FAQ - Tacticus Analytics | Frequently Asked Questions',
  description:
    'Get answers to common questions about using Tacticus Analytics for Warhammer 40,000: Tacticus guild raids. Learn about token tracking, performance metrics, API keys, and more.',
  keywords:
    'tacticus analytics faq, tacticus help, guild raid questions, token tracking help, api key setup, performance metrics guide',
  openGraph: {
    title: 'FAQ - Tacticus Analytics',
    description:
      'Get answers to common questions about using Tacticus Analytics for guild raid analytics',
    images: ['/faq/og']
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FAQ - Tacticus Analytics',
    description:
      'Get answers to common questions about using Tacticus Analytics for guild raid analytics',
    images: ['/faq/og']
  }
}

export default async function FAQ() {
  const authData = await getAuthUser()
  const tacticusSite = `${TACTICUS_API.ORIGIN}/`

  return (
    <div className="min-h-screen bg-(--bg-primary) text-primary-wh40k">
      <FAQSchema />
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        {/* Breadcrumbs */}
        <div className="mb-4">
          <Breadcrumbs items={[{ name: 'FAQ', href: '/faq' }]} />
        </div>

        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-(--primary) mb-2">
            Frequently Asked Questions
          </h1>
          <p className="text-sm sm:text-base text-secondary-wh40k">
            Guides for understanding and using the dashboard effectively
          </p>
        </div>

        <div className="space-y-8">
          {/* General Questions */}
          <section
            id="general-questions"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              General Questions
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  What is Tacticus Analytics?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Tacticus Analytics tracks Warhammer 40,000: Tacticus guild
                  raid data for clusters and independent guilds. It provides
                  damage metrics, leaderboards, token tracking, and management
                  tools for guild leadership across the Tacticus community.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  How do I get access?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Access is managed through guild membership. Contact your guild
                  officers or leaders to have your account activated.
                  You&apos;ll need to link your in-game display name to your
                  dashboard account.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  What are the different access levels?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Access is based on your role within the guild: Members have
                  access to basic features and statistics, Officers can manage
                  guild operations and view detailed analytics, and Leaders have
                  full administrative control.
                </p>
              </div>
            </div>
          </section>

          {/* Boss Leaderboards */}
          <section
            id="token-system"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Boss Leaderboards
            </h2>

            <div>
              <h3 className="font-semibold text-primary-wh40k mb-2">
                How do Boss Leaderboards work?
              </h3>
              <p className="text-secondary-wh40k text-sm mb-3">
                Boss leaderboards show the{' '}
                <strong className="text-primary-wh40k">
                  highest damage hits
                </strong>{' '}
                achieved against each boss, showcasing peak performance
                potential through sophisticated deduplication algorithms.
              </p>

              <div className="ml-4 space-y-2 text-sm">
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">
                    Records Your Best:
                  </strong>{' '}
                  Each unique team composition shows only your highest damage
                </p>
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">
                    Multiple Bosses:
                  </strong>{' '}
                  Separate leaderboards for each boss at each level (L1-L5,
                  M1-M5)
                </p>
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">Team Display:</strong>{' '}
                  Shows exact heroes + Machine of War with visual icons
                </p>
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">
                    Track Progress:
                  </strong>{' '}
                  See when you achieved each record
                </p>
              </div>

              <p className="text-xs mt-3 italic text-secondary-wh40k">
                <strong>Tip:</strong> Check the detailed FAQ on Boss
                Leaderboards page for complete deduplication algorithm
                explanation.
              </p>
            </div>
          </section>

          {/* Overall Rankings */}
          <section
            id="api-keys-data-sync"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Overall Rankings
            </h2>

            <div>
              <h3 className="font-semibold text-primary-wh40k mb-2">
                How do Overall Rankings work?
              </h3>
              <p className="text-secondary-wh40k text-sm mb-3">
                Overall rankings use the{' '}
                <strong className="text-primary-wh40k">
                  Performance Efficiency Algorithm
                </strong>{' '}
                to calculate skill-adjusted rankings that fairly compare players
                regardless of token usage.
              </p>

              <div className="ml-4 space-y-2 text-sm">
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">
                    Compare to Average:
                  </strong>{' '}
                  Your damage vs. what everyone else averages on each boss
                </p>
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">
                    Weighted by Activity:
                  </strong>{' '}
                  Bosses you fight more often count more toward your score
                </p>
                <p>
                  <span className="text-(--accent)">•</span>{' '}
                  <strong className="text-primary-wh40k">Final Score:</strong>{' '}
                  Shows how much better (+%) or worse (-%) you perform overall
                </p>
              </div>

              <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-sm text-xs">
                <strong className="text-yellow-400">Example:</strong> If cluster
                average is 2.5M and you average 3.0M:
                <br />
                Your efficiency = 3.0/2.5 = 1.20 ={' '}
                <span className="text-green-400">+20% performance</span>
              </div>

              <p className="text-xs mt-3 italic text-secondary-wh40k">
                <strong>Note:</strong> See the Overall Leaderboard page for
                complete calculation methodology including historical rankings.
              </p>
            </div>
          </section>

          {/* Token System */}
          <section
            id="themes-customization"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Token System
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  How does Token Tracking work?
                </h3>
                <p className="text-secondary-wh40k text-sm mb-3">
                  The token system tracks both{' '}
                  <strong className="text-primary-wh40k">
                    real-time availability
                  </strong>{' '}
                  and{' '}
                  <strong className="text-primary-wh40k">
                    season-wide usage
                  </strong>
                  .
                </p>

                <div className="ml-4 space-y-1 text-sm">
                  <p>
                    <span className="text-(--accent)">•</span> Players start
                    each season with 2 tokens
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Tokens regenerate
                    1 every 12 hours (max 3)
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Season cap is 28
                    tokens total
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Bombs have an
                    18-hour cooldown
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Warning status
                    indicates capped tokens (wasting regeneration)
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Key status
                    indicates player has uploaded their API key (golden =
                    synced)
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  How do Boss Assignment Tokens work?
                </h3>
                <p className="text-secondary-wh40k text-sm mb-3">
                  For upcoming season planning, players allocate their 3
                  available tokens across boss assignments:
                </p>

                <div className="ml-4 space-y-1 text-sm">
                  <p>
                    <span className="text-(--accent)">•</span>{' '}
                    <strong className="text-primary-wh40k">
                      Each player has:
                    </strong>{' '}
                    3 tokens to allocate for the season
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span>{' '}
                    <strong className="text-primary-wh40k">
                      Primary boss assignment:
                    </strong>{' '}
                    Consumes 2 tokens
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span>{' '}
                    <strong className="text-primary-wh40k">
                      Secondary boss assignment:
                    </strong>{' '}
                    Consumes 1 token
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* API Keys */}
          <section
            id="meta-analysis"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              API Keys & Data Sync
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  What are API Keys and why do I need one?
                </h3>
                <p className="text-secondary-wh40k text-sm mb-3">
                  API keys enable real-time data synchronization from the
                  official Tacticus API. Get your personal API key from{' '}
                  <a
                    href={tacticusSite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-(--accent) hover:text-(--primary) underline"
                  >
                    {tacticusSite}
                  </a>
                </p>

                <div className="ml-4 space-y-1 text-sm">
                  <p>
                    <span className="text-(--accent)">•</span> Enables real-time
                    token/bomb status tracking
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Provides accurate
                    availability calculations
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span> Managed through
                    your dashboard profile
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  How do I add my Player API key?
                </h3>
                <div className="text-secondary-wh40k text-sm space-y-1">
                  <p>
                    1. Go to{' '}
                    <a
                      href={tacticusSite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-(--accent) hover:text-(--primary) underline"
                    >
                      {tacticusSite}
                    </a>
                  </p>
                  <p>
                    2. Click &quot;Create New API Key&quot; with read access to:
                    Player
                  </p>
                  <p>3. Copy and paste the key into the dashboard</p>
                  <p>
                    4. The key indicator will turn golden when successfully
                    synced
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Do you share my raid information?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  We do not sell your raid information. Public Explore and
                  leaderboard pages may show obscured guild values. Members of
                  guilds in the same cluster can view this guild&apos;s
                  per-battle data.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Are you able to view our raid information?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Yes, just like any service that you share your API credentials
                  with we will be able to view your raid information. However,
                  we promise to only use this data at the aggregate level in the
                  meta analysis pages.
                </p>
              </div>
            </div>
          </section>

          {/* Themes & Customization */}
          <section
            id="troubleshooting"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Themes & Customization
            </h2>

            <div>
              <h3 className="font-semibold text-primary-wh40k mb-2">
                Can I change my dashboard theme?
              </h3>
              <p className="text-secondary-wh40k text-sm mb-3">
                Yes! The dashboard supports 35+ different themed color schemes
                including all major Warhammer 40K factions:
              </p>

              <div className="text-sm space-y-2">
                <div>
                  <h4 className="font-semibold text-primary-wh40k mb-1">
                    Available Themes Include:
                  </h4>
                  <div className="ml-4 text-xs grid grid-cols-2 md:grid-cols-3 gap-1 text-secondary-wh40k">
                    <p>• Ultramarines</p>
                    <p>• Blood Angels</p>
                    <p>• Dark Angels</p>
                    <p>• Imperial Fists</p>
                    <p>• Iron Warriors</p>
                    <p>• Alpha Legion</p>
                    <p>• Thousand Sons</p>
                    <p>• Death Guard</p>
                    <p>• Night Lords</p>
                    <p>• World Eaters</p>
                    <p>• Space Wolves</p>
                    <p>• Raven Guard</p>
                    <p>• Salamanders</p>
                    <p>• Black Templars</p>
                    <p>• And many more...</p>
                  </div>
                </div>
              </div>

              <p className="text-secondary-wh40k text-sm mt-2">
                Access theme settings through your profile page. A theme preview
                is available to compare all options.
              </p>
              <p className="text-secondary-wh40k text-sm mt-1">
                Guild leaders can set a default theme for their guild through
                the guild settings page.
              </p>
            </div>
          </section>

          {/* Meta Analysis */}
          <section
            id="votlw"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Meta Analysis
            </h2>

            <div>
              <h3 className="font-semibold text-primary-wh40k mb-2">
                What is the Meta Analysis page?
              </h3>
              <p className="text-secondary-wh40k text-sm mb-3">
                The Meta Analysis page identifies the{' '}
                <strong className="text-primary-wh40k">
                  most consistent high-performing team compositions
                </strong>{' '}
                for each boss by analyzing damage patterns:
              </p>

              <div className="space-y-3 text-sm">
                <div>
                  <h4 className="font-semibold text-primary-wh40k mb-2">
                    How it Works:
                  </h4>
                  <div className="ml-4 space-y-1">
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>High Damage Teams:</strong> Shows which team
                      compositions deal the most damage
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>Consistent Performance:</strong> Prioritizes teams
                      that perform reliably across multiple battles
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>Stability Ratings:</strong>
                    </p>
                    <div className="ml-6 space-y-1">
                      <p>
                        -{' '}
                        <strong className="text-green-400">
                          High Stability
                        </strong>
                        : Very consistent damage output
                      </p>
                      <p>
                        -{' '}
                        <strong className="text-yellow-400">
                          Medium Stability
                        </strong>
                        : Moderately consistent performance
                      </p>
                      <p>
                        -{' '}
                        <strong className="text-red-400">Low Stability</strong>:
                        Inconsistent/risky performance
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-primary-wh40k mb-2">
                    What You&apos;ll See:
                  </h4>
                  <div className="ml-4 space-y-1">
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>Team Compositions</strong>: Exact heroes + Machine
                      of War icons
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>Damage Stats</strong>: Min/Max/Average damage for
                      each team
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>Usage Count</strong>: How many times each team was
                      used
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span>{' '}
                      <strong>Player Info</strong>: Who used each composition
                      successfully
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-primary-wh40k mb-2">
                    Filter Options:
                  </h4>
                  <div className="ml-4 space-y-1">
                    <p>
                      <span className="text-(--accent)">•</span> Choose specific
                      boss levels
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span> View your guild
                      vs. everyone
                    </p>
                    <p>
                      <span className="text-(--accent)">•</span> Main bosses vs.
                      side encounters
                    </p>
                  </div>
                </div>

                <p className="text-xs mt-3 italic text-secondary-wh40k">
                  <strong>Tip:</strong> Teams with high average damage AND high
                  stability are the most reliable choices for consistent
                  performance.
                </p>
              </div>
            </div>
          </section>

          {/* Troubleshooting */}
          <section
            id="support-contact"
            className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6 scroll-mt-24"
          >
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Troubleshooting
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Why am I seeing &quot;No data&quot; for some metrics?
                </h3>
                <div className="ml-4 space-y-1 text-sm text-secondary-wh40k">
                  <p>
                    <span className="text-(--accent)">•</span>{' '}
                    <strong className="text-primary-wh40k">
                      Performance percentages:
                    </strong>{' '}
                    Requires at least 1 battle against that boss
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span>{' '}
                    <strong className="text-primary-wh40k">
                      Historical data:
                    </strong>{' '}
                    May take time to sync after initial account creation
                  </p>
                  <p>
                    <span className="text-(--accent)">•</span>{' '}
                    <strong className="text-primary-wh40k">API sync:</strong>{' '}
                    Add your Player API key for real-time accuracy
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  I can&apos;t see certain pages or features
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Check your role permissions. Some features are restricted to
                  Officers/Leaders only. Contact your guild leadership if you
                  need elevated permissions.
                </p>
              </div>
            </div>
          </section>

          {/* VOTLW Awards */}
          <section className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6">
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Veteran of the Long War (VOTLW)
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  What are VOTLW standings?
                </h3>
                <p className="text-secondary-wh40k text-sm mb-3">
                  Veteran of the Long War (VOTLW) is a point-based season
                  competition that ranks players across multiple categories of
                  achievement.
                </p>

                <div className="space-y-3 text-sm">
                  <div>
                    <h4 className="font-semibold text-primary-wh40k mb-2">
                      Set Medals (per boss level L1-L5, M1-M5):
                    </h4>
                    <div className="ml-4 space-y-1">
                      <p>
                        <span className="text-(--accent)">•</span>{' '}
                        <strong className="text-yellow-400">
                          Gold Medal (3 pts)
                        </strong>
                        : Highest average damage per token on main boss
                        (requires 2+ battles)
                      </p>
                      <p>
                        <span className="text-(--accent)">•</span>{' '}
                        <strong className="text-secondary-wh40k">
                          Silver Medal (2 pts)
                        </strong>
                        : Second highest average damage per token
                      </p>
                      <p>
                        <span className="text-(--accent)">•</span>{' '}
                        <strong className="text-orange-600">
                          Bronze Medal (1 pt)
                        </strong>
                        : Third highest average damage per token
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary-wh40k mb-2">
                      Most Damage Awards (1 pt each):
                    </h4>
                    <p className="ml-4 text-secondary-wh40k">
                      Highest total damage dealt to each main boss (regardless
                      of token count)
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary-wh40k mb-2">
                      Side Boss Winners (2 pts each):
                    </h4>
                    <div className="ml-4 space-y-1">
                      <p>
                        <span className="text-(--accent)">•</span> Best average
                        damage per token on Side Boss 1 and Side Boss 2 of each
                        set
                      </p>
                      <p>
                        <span className="text-(--accent)">•</span> Tie-breaker:
                        More tokens spent (rewards consistency)
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary-wh40k mb-2">
                      Biggest Hit Awards (1 pt each):
                    </h4>
                    <p className="ml-4 text-secondary-wh40k">
                      Single highest damage value dealt to each main boss in one
                      attack
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary-wh40k mb-2">
                      Season-Wide Awards:
                    </h4>
                    <div className="ml-4 space-y-1">
                      <p>
                        <span className="text-(--accent)">•</span>{' '}
                        <strong className="text-red-400">
                          Top Killer (3 pts)
                        </strong>
                        : Most last hits (kills) across all bosses
                      </p>
                      <p>
                        <span className="text-(--accent)">•</span>{' '}
                        <strong className="text-(--accent)">
                          Best Bomber (0.5 pts)
                        </strong>
                        : Highest single bomb damage in the season
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-primary-wh40k mb-2">
                      Final Winner Determination:
                    </h4>
                    <div className="ml-4 space-y-1">
                      <p>
                        <span className="text-(--accent)">•</span> All points
                        totaled across all categories
                      </p>
                      <p>
                        <span className="text-(--accent)">•</span>{' '}
                        <strong>Tie-breaking (in order)</strong>:
                      </p>
                      <div className="ml-8 space-y-1">
                        <p>
                          1. Total tokens spent (more is better - shows
                          participation)
                        </p>
                        <p>
                          2. First token timing (earlier is better - shows
                          proactiveness)
                        </p>
                      </div>
                      <p>
                        <span className="text-(--accent)">•</span> Token
                        offenders cannot win regardless of point total
                      </p>
                    </div>
                  </div>

                  <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3">
                    <h4 className="font-semibold text-red-400 mb-2">
                      Important: Token Offender Exclusion
                    </h4>
                    <p className="text-secondary-wh40k text-sm">
                      Players who are flagged as token offenders (missing 4+
                      tokens from the maximum possible) are automatically
                      excluded from ALL awards. This ensures awards go to active
                      participants who contribute consistently to guild raids.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Support */}
          <section className="bg-(--card) border border-(--card-border) rounded-lg p-4 sm:p-6">
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Support & Contact
            </h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Do you share my raid information?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  We do not sell your raid information. Public Explore and
                  leaderboard pages may show obscured guild values. Members of
                  guilds in the same cluster can view this guild&apos;s
                  per-battle data.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  Are you able to view our raid information?
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Yes, just like any service that you share your API credentials
                  with we will be able to view your raid information. However,
                  we promise to only use this data at the aggregate level in the
                  meta analysis pages.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  How can I support the project?
                </h3>
                <p className="text-secondary-wh40k text-sm mb-3">
                  Use the referral code{' '}
                  <span className="font-mono bg-(--card) px-2 py-1 rounded-sm text-(--accent) font-semibold border border-(--card-border)">
                    TEN-05-BID
                  </span>{' '}
                  in Warhammer 40,000: Tacticus to support the developer!
                </p>
                <p className="text-secondary-wh40k text-sm">
                  You can also{' '}
                  <a
                    href="https://www.buymeacoffee.com/timmyman"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-(--accent) hover:underline font-semibold"
                  >
                    buy me a coffee
                  </a>{' '}
                  to help with hosting costs and development time.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-primary-wh40k mb-2">
                  I found a bug or have a feature request
                </h3>
                <p className="text-secondary-wh40k text-sm">
                  Contact your guild leaders or mention @TimmyMan in guild
                  Discord channels. Include specific details about what you
                  expected vs. what happened.
                </p>
              </div>
            </div>
          </section>

          {/* Detailed Calculation FAQs */}
          <section className="bg-linear-to-r from-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-(--card-border) rounded-lg p-6">
            <h2 className="text-xl font-bold text-(--primary) mb-4 flex items-center gap-2">
              Detailed Calculation Guides
            </h2>

            <div className="text-secondary-wh40k text-sm">
              <p className="mb-3">
                Each major dashboard page now includes a{' '}
                <strong className="text-primary-wh40k">
                  &quot;How This Works&quot; FAQ section
                </strong>
                with detailed calculation methodologies, algorithms, and
                examples.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 bg-(--card) rounded-sm border border-(--card-border)">
                  <h3 className="font-semibold text-primary-wh40k mb-2">
                    Dashboard Pages
                  </h3>
                  <ul className="text-xs space-y-1">
                    <li>
                      • <strong>Player Stats:</strong> Weighted performance
                      calculations
                    </li>
                    <li>
                      • <strong>Player Performance:</strong> Efficiency
                      algorithms
                    </li>
                    <li>
                      • <strong>Boss Performance:</strong> Ranking methodologies
                    </li>
                    <li>
                      • <strong>Token Usage:</strong> Availability formulas
                    </li>
                    <li>
                      • <strong>VOTLW:</strong> Point systems & medal logic
                    </li>
                  </ul>
                </div>

                <div className="p-3 bg-(--card) rounded-sm border border-(--card-border)">
                  <h3 className="font-semibold text-primary-wh40k mb-2">
                    Cluster Pages
                  </h3>
                  <ul className="text-xs space-y-1">
                    <li>
                      • <strong>Overall Leaderboard:</strong> Performance
                      efficiency
                    </li>
                    <li>
                      • <strong>Boss Leaderboards:</strong> Deduplication
                      algorithms
                    </li>
                    <li>
                      • <strong>Meta Analysis:</strong> Sharpe ratio
                      calculations
                    </li>
                    <li>
                      • <strong>Leader Analytics:</strong> Guild metrics
                    </li>
                    <li>
                      • <strong>Cluster Management:</strong> Admin procedures
                    </li>
                  </ul>
                </div>
              </div>

              <p className="text-xs mt-4 italic text-center">
                Look for the collapsible{' '}
                <strong>&quot;How This Works&quot;</strong> section on each page
                for in-depth explanations
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
