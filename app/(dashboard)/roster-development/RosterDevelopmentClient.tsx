'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'
import { formatNumber } from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import {
  Users,
  Target,
  TrendingUp,
  Shield,
  AlertTriangle,
  BarChart3,
  Star,
  CheckCircle2
} from 'lucide-react'
import { MemberGapAnalysisTab } from './components/MemberGapAnalysisTab'

interface RosterDevelopmentClientProps {
  guildCode: string
}

interface RosterDevelopmentSummary {
  members_total: number
  members_with_roster: number
  members_with_api_key: number
  members_with_loki: number
  roster_coverage_pct: number
  hero_count: number
  missing_heroes: number
  meta_teams_analyzed: number
  roster_complete: boolean
  partial_roster: boolean
  loki_used: boolean
}

interface RosterGap {
  hero_name: string
  appears_in_meta_teams: number
  damage_boost_potential: number
  boss_types: string[]
  priority_score: number
}

interface RosterPriority {
  hero_name: string
  appears_in_meta_teams: number
  damage_potential: number
  boss_types: string[]
  priority_score: number
}

interface BossCoverage {
  boss_type: string
  teams_analyzed: number
  teams_available: number
  coverage_pct: number
}

interface TeamRecommendation {
  composition: string
  damage_p90: number
  damage_avg: number
  attack_count: number
  rarity?: string | null
  rarity_set?: string | null
  missing_units: string[]
}

interface BossRecommendation {
  boss_type: string
  available_teams: TeamRecommendation[]
  close_teams: TeamRecommendation[]
  coverage_pct: number
}

interface RosterDevelopmentAnalysis {
  guild_code: string
  season: string
  summary: RosterDevelopmentSummary
  gaps: RosterGap[]
  development_priorities: RosterPriority[]
  coverage_by_boss: BossCoverage[]
  recommendations_by_boss: BossRecommendation[]
  hero_icons: Record<string, string>
  warnings: string[]
}

type HeroPriorityItem = {
  hero_name: string
  appears_in_meta_teams: number
  impact: number
  boss_types: string[]
}

function StatCard({
  label,
  value,
  subLabel,
  icon: Icon,
  iconClass,
  bgClass
}: {
  label: string
  value: string
  subLabel?: string
  icon: ComponentType<{ className?: string }>
  iconClass: string
  bgClass: string
}) {
  return (
    <Card className="bg-(--card-bg) border-(--card-border)">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bgClass}`}>
          <Icon className={`w-5 h-5 ${iconClass}`} />
        </div>
        <div>
          <div className="text-sm text-secondary-wh40k">{label}</div>
          <div className="text-lg font-semibold text-primary-wh40k">
            {value}
          </div>
          {subLabel && (
            <div className="text-xs text-secondary-wh40k">{subLabel}</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function HeroPriorityGrid({
  items,
  heroIcons,
  emptyLabel
}: {
  items: HeroPriorityItem[]
  heroIcons: Record<string, string>
  emptyLabel: string
}) {
  if (items.length === 0) {
    return (
      <Card className="bg-(--card-bg) border-(--card-border)">
        <CardContent className="py-6 text-center text-sm text-secondary-wh40k">
          {emptyLabel}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const icon = heroIcons[item.hero_name.toLowerCase()] || ''
        return (
          <div
            key={item.hero_name}
            className="flex items-start gap-3 p-3 rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] border border-(--card-border)"
          >
            <div className="relative shrink-0">
              {icon ? (
                <img
                  src={icon}
                  alt={item.hero_name}
                  className="w-10 h-10 rounded-sm"
                  loading="lazy"
                />
              ) : (
                <div className="w-10 h-10 rounded-sm bg-(--card-bg) flex items-center justify-center text-secondary-wh40k text-xs font-semibold">
                  {item.hero_name.slice(0, 2)}
                </div>
              )}
              {items.indexOf(item) < 3 && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center">
                  <Star
                    className="w-2.5 h-2.5 text-amber-900"
                    fill="currentColor"
                  />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-primary-wh40k truncate">
                {item.hero_name}
              </div>
              <div className="text-xs text-secondary-wh40k">
                Appears in {item.appears_in_meta_teams} top teams
              </div>
              <div className="text-xs text-secondary-wh40k">
                Impact: {formatNumber(item.impact)}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {item.boss_types.slice(0, 3).map((boss) => (
                  <span
                    key={boss}
                    className="text-[10px] px-1.5 py-0.5 rounded-sm bg-(--card-bg) text-secondary-wh40k"
                  >
                    {getBossDisplayName(boss).slice(0, 10)}
                  </span>
                ))}
                {item.boss_types.length > 3 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-(--card-bg) text-secondary-wh40k">
                    +{item.boss_types.length - 3}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CoverageList({ coverage }: { coverage: BossCoverage[] }) {
  if (coverage.length === 0) {
    return (
      <div className="text-sm text-secondary-wh40k">
        No boss coverage data available yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {coverage.map((boss) => (
        <div key={boss.boss_type} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-primary-wh40k">
              {getBossDisplayName(boss.boss_type)}
            </span>
            <span className="text-secondary-wh40k">
              {boss.coverage_pct}% ({boss.teams_available}/{boss.teams_analyzed}
              )
            </span>
          </div>
          <div className="h-2 rounded-full bg-(--bg-secondary)">
            <div
              className="h-2 rounded-full bg-emerald-400"
              style={{ width: `${boss.coverage_pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function DataCoverageCard({
  summary,
  lastUpdated
}: {
  summary: RosterDevelopmentSummary | null
  lastUpdated: Date | null
}) {
  const hasMounted = useHasMounted()
  if (!summary || summary.members_with_roster === 0) {
    return null
  }

  const statusLabel = summary.roster_complete
    ? 'Full coverage'
    : summary.partial_roster
      ? 'Partial coverage'
      : 'Limited coverage'

  const statusClass = summary.roster_complete
    ? 'text-emerald-400 bg-emerald-400/10'
    : summary.partial_roster
      ? 'text-amber-300 bg-amber-400/10'
      : 'text-secondary-wh40k bg-(--bg-secondary)'

  return (
    <Card className="bg-(--card-bg) border-(--card-border)">
      <CardContent className="py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-primary-wh40k">
                Data Coverage
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${statusClass}`}
              >
                {statusLabel}
              </span>
            </div>
            <p className="text-xs text-secondary-wh40k mt-1">
              {summary.members_with_roster} of {summary.members_total} members
              have roster data.
            </p>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              <span className="px-2 py-1 rounded-sm bg-(--bg-secondary) text-secondary-wh40k">
                API keys: {summary.members_with_api_key}
              </span>
              <span className="px-2 py-1 rounded-sm bg-(--bg-secondary) text-secondary-wh40k">
                Coverage: {summary.roster_coverage_pct}%
              </span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            {lastUpdated && (
              <span className="text-xs text-secondary-wh40k">
                Updated {hasMounted ? lastUpdated.toLocaleString() : '—'}
              </span>
            )}
            {summary.partial_roster && (
              <Link href="/guild-management/members">
                <Button
                  variant="outline"
                  className="border-(--card-border) text-primary-wh40k"
                >
                  Request API Keys
                </Button>
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function GapAnalysisTab({
  analysis
}: {
  analysis: RosterDevelopmentAnalysis | null
}) {
  if (!analysis) {
    return null
  }

  const hasMetaData = analysis.summary.meta_teams_analyzed > 0
  const gapItems: HeroPriorityItem[] = analysis.gaps.slice(0, 9).map((gap) => ({
    hero_name: gap.hero_name,
    appears_in_meta_teams: gap.appears_in_meta_teams,
    impact: gap.damage_boost_potential,
    boss_types: gap.boss_types
  }))

  const coverage = analysis.coverage_by_boss.slice(0, 6)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <StatCard
          label="Roster Coverage"
          value={`${analysis.summary.roster_coverage_pct}%`}
          subLabel={`${analysis.summary.members_with_roster}/${analysis.summary.members_total} members`}
          icon={Shield}
          iconClass="text-emerald-400"
          bgClass="bg-emerald-400/20"
        />
        <StatCard
          label="Unique Heroes"
          value={analysis.summary.hero_count.toString()}
          subLabel="Guild-wide roster size"
          icon={Users}
          iconClass="text-blue-400"
          bgClass="bg-blue-400/20"
        />
        <StatCard
          label="Missing Heroes"
          value={analysis.summary.missing_heroes.toString()}
          subLabel="Meta coverage gaps"
          icon={Target}
          iconClass="text-amber-400"
          bgClass="bg-amber-400/20"
        />
        <StatCard
          label="Teams Analyzed"
          value={analysis.summary.meta_teams_analyzed.toString()}
          subLabel={`Season ${analysis.season}`}
          icon={BarChart3}
          iconClass="text-purple-400"
          bgClass="bg-purple-400/20"
        />
      </div>

      {!hasMetaData && (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-5 text-sm text-secondary-wh40k">
            Meta Atlas benchmarks are unavailable for this season. Gap analysis
            will refresh once new meta data is available.
          </CardContent>
        </Card>
      )}

      <Card className="bg-(--card-bg) border-(--card-border)">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="w-5 h-5 text-amber-400" />
            Highest Impact Gaps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <HeroPriorityGrid
            items={gapItems}
            heroIcons={analysis.hero_icons}
            emptyLabel="No roster gaps detected in the top meta teams."
          />
        </CardContent>
      </Card>

      <Card className="bg-(--card-bg) border-(--card-border)">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            Boss Coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CoverageList coverage={coverage} />
        </CardContent>
      </Card>
    </div>
  )
}

function DevelopmentTab({
  analysis
}: {
  analysis: RosterDevelopmentAnalysis | null
}) {
  if (!analysis) {
    return null
  }

  const hasMetaData = analysis.summary.meta_teams_analyzed > 0
  const items: HeroPriorityItem[] = analysis.development_priorities
    .slice(0, 9)
    .map((hero) => ({
      hero_name: hero.hero_name,
      appears_in_meta_teams: hero.appears_in_meta_teams,
      impact: hero.damage_potential,
      boss_types: hero.boss_types
    }))

  return (
    <div className="space-y-6">
      <Card className="bg-linear-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30">
        <CardContent className="py-8 text-center">
          <TrendingUp className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Development Paths
          </h3>
          <p className="text-secondary-wh40k max-w-lg mx-auto mb-6">
            Focus upgrades on the heroes you already own that appear most
            frequently in top-performing meta teams.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 rounded-full text-amber-300 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Live Analysis
          </div>
        </CardContent>
      </Card>

      {!hasMetaData && (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-5 text-sm text-secondary-wh40k">
            Development priorities will appear once Meta Atlas benchmarks are
            available.
          </CardContent>
        </Card>
      )}

      <Card className="bg-(--card-bg) border-(--card-border)">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400" />
            High-Impact Upgrade Targets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <HeroPriorityGrid
            items={items}
            heroIcons={analysis.hero_icons}
            emptyLabel="No upgrade priorities identified yet."
          />
        </CardContent>
      </Card>
    </div>
  )
}

function CompositionsTab({
  analysis
}: {
  analysis: RosterDevelopmentAnalysis | null
}) {
  if (!analysis) {
    return null
  }

  const hasMetaData = analysis.summary.meta_teams_analyzed > 0
  const bossCards = analysis.recommendations_by_boss.slice(0, 4)
  const hasRecommendations = bossCards.some(
    (boss) => boss.available_teams.length > 0 || boss.close_teams.length > 0
  )

  return (
    <div className="space-y-6">
      <Card className="bg-linear-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
        <CardContent className="py-8 text-center">
          <Shield className="w-12 h-12 text-cyan-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Optimal Raid Compositions
          </h3>
          <p className="text-secondary-wh40k max-w-lg mx-auto mb-6">
            See which meta teams your guild can field today, and which lineups
            are close with one or two roster additions.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/20 rounded-full text-cyan-300 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Live Analysis
          </div>
        </CardContent>
      </Card>

      {!hasMetaData && (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-5 text-sm text-secondary-wh40k">
            Composition recommendations require Meta Atlas benchmark data.
          </CardContent>
        </Card>
      )}

      {hasMetaData && !hasRecommendations && (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-5 text-sm text-secondary-wh40k">
            No viable compositions detected yet. Focus on closing the top roster
            gaps.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {bossCards.map((boss) => {
          const teamsToShow =
            boss.available_teams.length > 0
              ? boss.available_teams
              : boss.close_teams
          const title =
            boss.available_teams.length > 0
              ? 'Available Teams'
              : 'Closest Teams'
          return (
            <Card
              key={boss.boss_type}
              className="bg-(--card-bg) border-(--card-border)"
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="text-primary-wh40k">
                    {getBossDisplayName(boss.boss_type)}
                  </span>
                  <span className="text-xs px-2 py-1 rounded-sm bg-(--bg-secondary) text-secondary-wh40k">
                    {boss.coverage_pct}% coverage
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                  {title}
                </div>
                {teamsToShow.length === 0 && (
                  <div className="text-sm text-secondary-wh40k">
                    No viable compositions yet. Focus on the missing heroes list
                    for this boss.
                  </div>
                )}
                {teamsToShow.map((team) => (
                  <div
                    key={`${boss.boss_type}-${team.composition}`}
                    className="p-3 rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] border border-(--card-border)"
                  >
                    <div className="text-sm font-semibold text-primary-wh40k">
                      {team.composition}
                    </div>
                    <div className="text-xs text-secondary-wh40k mt-1">
                      P90 {formatNumber(team.damage_p90)} · Avg{' '}
                      {formatNumber(team.damage_avg)} · {team.attack_count}{' '}
                      attacks
                    </div>
                    {team.rarity_set && (
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-secondary-wh40k">
                        {team.rarity_set}
                      </div>
                    )}
                    {team.missing_units.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {team.missing_units.map((unit) => (
                          <span
                            key={unit}
                            className="text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-300"
                          >
                            Missing {unit}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function RosterDevelopmentClient({
  guildCode
}: RosterDevelopmentClientProps) {
  const [analysis, setAnalysis] = useState<RosterDevelopmentAnalysis | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchAnalysis = async () => {
      if (!guildCode) {
        setLoading(false)
        setError('Guild code unavailable')
        return
      }
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ include_loki: 'true' })
        const response = await fetch(
          `/api/roster-development/analysis?${params}`
        )
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load roster analysis')
        }

        if (!cancelled) {
          setAnalysis(data)
          setLastUpdated(new Date())
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load roster analysis'
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchAnalysis()
    return () => {
      cancelled = true
    }
  }, [guildCode])

  const [activeTab, setActiveTab] = useState('gaps')
  const tabs = useMemo(
    () => [
      { value: 'gaps', label: 'Gap Analysis' },
      { value: 'members', label: 'Member Analysis' },
      { value: 'development', label: 'Development' },
      { value: 'compositions', label: 'Compositions' }
    ],
    []
  )

  const warnings = analysis?.warnings ?? []
  const hasRosterData = (analysis?.summary.members_with_roster ?? 0) > 0

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3 text-amber-200 text-sm">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div className="space-y-1">
                {warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <DataCoverageCard
        summary={analysis?.summary ?? null}
        lastUpdated={lastUpdated}
      />

      {loading && (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-10">
            <div className="flex justify-center">
              <LoadingSpinner message="Analyzing guild roster..." />
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="py-6 text-red-400 text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {!loading && !error && analysis && !hasRosterData && (
        <Card className="bg-(--card-bg) border-(--card-border)">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
              No Roster Data Yet
            </h3>
            <p className="text-secondary-wh40k max-w-md mx-auto mb-4">
              Ask members to link their Player API key to unlock roster
              development insights.
            </p>
            <Link href="/guild-management/members">
              <Button
                variant="outline"
                className="border-(--card-border) text-primary-wh40k"
              >
                Request API Keys
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {!loading && !error && analysis && hasRosterData && (
        <div className="space-y-4">
          <PageTabsSubnav
            ariaLabel="Roster Development sections"
            value={activeTab}
            onValueChange={setActiveTab}
            tabs={tabs}
          />
          {activeTab === 'gaps' && <GapAnalysisTab analysis={analysis} />}
          {activeTab === 'members' && <MemberGapAnalysisTab />}
          {activeTab === 'development' && (
            <DevelopmentTab analysis={analysis} />
          )}
          {activeTab === 'compositions' && (
            <CompositionsTab analysis={analysis} />
          )}
        </div>
      )}

      <Card className="bg-card/50 border-(--card-border)">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-secondary-wh40k space-y-2">
              <p>
                <strong className="text-primary-wh40k">Prerequisites:</strong>{' '}
                Full roster development features require members to link their
                player API keys to provide hero roster data.
              </p>
              <p>
                <strong className="text-primary-wh40k">Integration:</strong>{' '}
                This feature integrates with Meta Atlas benchmarks to provide
                guild-specific recommendations based on aggregated performance
                data.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
