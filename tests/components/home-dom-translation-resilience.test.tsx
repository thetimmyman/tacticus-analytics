import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '@/app/components/visualizations/ProgressBar'
import YourNextMoveCard from '@/app/components/briefing/YourNextMoveCard'
import { LoopAnalysisSection } from '@/app/components/dashboard-summary/LoopAnalysisSection'
import SeasonOutlookCard from '@/app/components/briefing/SeasonOutlookCard'
import BossPerformanceTable from '@/app/components/briefing/BossPerformanceTable'
import PrimeTargetsCard from '@/app/components/briefing/PrimeTargetsCard'
import TokenAvailability from '@/app/components/TokenAvailability'
import type { NextMove, PrimeTarget } from '@/app/lib/briefing/types'
import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
import type { MemberBossPerformance } from '@/app/lib/briefing/load-member-boss-performance'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/home'
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}))

vi.mock('@/app/components/navigation/ChromeLink', () => ({
  ChromeLink: ({
    children,
    href,
    className
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}))

vi.mock('@/app/components/ui/BossPortrait', () => ({
  BossPortrait: ({ bossName }: { bossName: string }) => (
    <div data-testid={`portrait-${bossName}`} />
  )
}))

vi.mock('@/app/components/RechartsWrapper', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Bar: () => null,
  Line: () => null
}))

vi.mock('@/app/components/error', () => ({
  ChartErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}))

/**
 * Mirrors browser page-translation DOM mutations (wrapping non-empty text
 * nodes inside nested <font> elements, which detaches them as direct children
 * of their original element parent).
 */
function simulateBrowserTranslation(root: Element): number {
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    const textNode = current as Text
    const parent = textNode.parentElement
    if (
      textNode.nodeValue &&
      textNode.nodeValue.trim().length > 0 &&
      parent &&
      parent.tagName.toLowerCase() !== 'font'
    ) {
      textNodes.push(textNode)
    }
    current = walker.nextNode()
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentNode
    if (!parent) continue
    const outerFont = document.createElement('font')
    const innerFont = document.createElement('font')
    parent.replaceChild(outerFont, textNode)
    outerFont.appendChild(innerFont)
    innerFont.appendChild(textNode)
  }

  return textNodes.length
}

function makeMove(overrides: Partial<NextMove> = {}): NextMove {
  return {
    state: 'hold',
    headline: 'Hold for next token',
    detail: 'Your raid token regenerates shortly.',
    confidence: 'high',
    reasonCodes: ['main_alive', 'no_token'],
    basis: ['Current loop snapshot'],
    sourceTimestamps: {},
    target: {
      name: 'Mortarion',
      displayName: 'Mortarion',
      levelCode: 'L5',
      encounterId: 0,
      hpPercentage: 64
    },
    primaryAction: {
      label: 'Open playbook',
      href: '/boss-playbooks'
    },
    ...overrides
  }
}

function makePrimeTarget(overrides: Partial<PrimeTarget> = {}): PrimeTarget {
  return {
    encounterId: 1,
    name: 'MantisWarrior',
    displayName: 'Mantis Warrior',
    levelCode: 'L5',
    hpPercentage: 80,
    remainingHp: null,
    behaviour: 'kill',
    thresholdHpPct: null,
    ...overrides
  }
}

describe('DOM translation resilience for home and dashboard components', () => {
  const originalConsoleError = console.error
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        tokenInfo: {
          tokensAvailable: 3,
          nextTokenSeconds: null
        }
      })
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    console.error = originalConsoleError
    vi.unstubAllGlobals()
  })

  it('negative control: unguarded conditional text sibling before translated text throws NotFoundError', () => {
    function UnguardedBadge({ positive }: { positive: boolean }) {
      return (
        <span>
          vsCluster {positive ? '+' : ''}
          {positive ? 12 : 0}%
        </span>
      )
    }

    console.error = vi.fn()
    const { container, rerender } = render(<UnguardedBadge positive={false} />)
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    expect(() => rerender(<UnguardedBadge positive={true} />)).toThrow(
      /insertBefore|not a child/i
    )
  })

  it('negative control: unguarded swapped element before translated text throws NotFoundError', () => {
    function UnguardedPill({ active }: { active: boolean }) {
      return (
        <span>
          {active ? <i data-testid="active" /> : <b data-testid="idle" />}
          {active ? 'Action available' : 'Hold'}
        </span>
      )
    }

    console.error = vi.fn()
    const { container, rerender } = render(<UnguardedPill active={false} />)
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    expect(() => rerender(<UnguardedPill active={true} />)).toThrow(
      /insertBefore|not a child/i
    )
  })

  it('updates ProgressBar vsClusterPercent across zero/negative/positive transitions under translated DOM', () => {
    const { container, rerender } = render(
      <ProgressBar
        label="L5 Mortarion"
        avgValue={150000}
        maxValue={300000}
        vsClusterPercent={0}
      />
    )

    expect(container).toHaveTextContent('vsCluster 0%')
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <ProgressBar
        label="L5 Mortarion"
        avgValue={185000}
        maxValue={300000}
        vsClusterPercent={12}
      />
    )
    expect(container).toHaveTextContent('vsCluster +12%')

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <ProgressBar
        label="L5 Mortarion"
        avgValue={110000}
        maxValue={300000}
        vsClusterPercent={-6}
      />
    )
    expect(container).toHaveTextContent('vsCluster -6%')
  })

  it('transitions YourNextMoveCard status pill and prime badges cleanly under translated DOM', () => {
    const initialMove = makeMove({
      state: 'hold',
      primeTargets: [makePrimeTarget({ behaviour: 'kill' })]
    })

    const { container, rerender } = render(
      <YourNextMoveCard move={initialMove} />
    )

    expect(screen.getByTestId('your-next-move-card')).toHaveTextContent('Hold')
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    const attackMove = makeMove({
      state: 'attack',
      headline: 'Attack Mortarion now',
      reasonCodes: ['main_alive', 'token_available'],
      primeTargets: [
        makePrimeTarget({ behaviour: 'threshold', thresholdHpPct: 25 })
      ]
    })

    rerender(<YourNextMoveCard move={attackMove} />)
    expect(screen.getByTestId('your-next-move-card')).toHaveTextContent(
      'Action available'
    )
    expect(screen.getByTestId('your-next-move-card')).toHaveTextContent('↓25%')

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <YourNextMoveCard
        move={makeMove({
          state: 'done',
          target: {
            name: 'Mortarion',
            displayName: 'Mortarion',
            levelCode: 'L5',
            encounterId: 1,
            hpPercentage: 30
          }
        })}
      />
    )
    expect(screen.getByTestId('your-next-move-card')).toHaveTextContent(
      'Nothing to do now'
    )
  })

  it('toggles LoopAnalysisSection details button and subtitle under translated DOM', () => {
    const aggregates = [
      {
        loopIndex: 1,
        bosses: [
          { name: 'L5 Mortarion', avgDamage: 250000, isPrime: false },
          { name: 'L5 Mantis', avgDamage: 120000, isPrime: true }
        ],
        totalAvgDamage: 370000,
        avgDamagePerBoss: 185000,
        bossCount: 2,
        bossTokens: 12,
        primeTokens: 4,
        totalTokens: 16,
        trend: 'improving' as const
      }
    ]

    const baseProps = {
      dashboardLoopAggregates: aggregates,
      selectedDashboardBoss: null as string | null,
      setSelectedDashboardBoss: vi.fn(),
      showPrimesOnly: false,
      setShowPrimesOnly: vi.fn(),
      showLoopAnalysisTable: false,
      setShowLoopAnalysisTable: vi.fn(),
      expandedDashboardLoops: new Set<number>(),
      toggleDashboardLoopExpanded: vi.fn()
    }

    const { container, rerender } = render(
      <LoopAnalysisSection {...baseProps} />
    )
    expect(screen.getByRole('button', { name: /show details/i })).toBeTruthy()
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <LoopAnalysisSection
        {...baseProps}
        showLoopAnalysisTable={true}
        showPrimesOnly={true}
      />
    )
    expect(screen.getByRole('button', { name: /hide details/i })).toBeTruthy()

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <LoopAnalysisSection
        {...baseProps}
        showLoopAnalysisTable={false}
        selectedDashboardBoss="L5 Mortarion"
      />
    )
    expect(screen.getByRole('button', { name: /show details/i })).toBeTruthy()
  })

  it('updates SeasonOutlookCard pluralization and finish details under translated DOM', () => {
    const forecast: SeasonForecastEnvelope = {
      season: {
        number: 100,
        starts_at: '2026-01-01T00:00:00Z',
        ends_at: '2026-01-15T00:00:00Z',
        seconds_remaining: 172800
      },
      tokens: {
        available_now: 20,
        yet_to_regen: 60,
        capacity: 80,
        cap_bound_players: 1,
        estimated_cap_waste: 2
      },
      bombs: {
        available_now: 5,
        yet_to_regen: 10,
        capacity: 15
      },
      lap_projection: {
        current_lap: 3,
        tokens_into_current_lap: 15,
        projected_lap_cost: 40,
        projected_finish_lap: 4,
        projected_finish_pct: 0.5,
        basis: 'last_n_laps',
        confidence: 'medium',
        n: 3
      },
      per_player: []
    }

    const outlookOne: SeasonOutlookProjection = {
      guildCode: 'TEST',
      season: 100,
      generatedAt: '2026-01-01T00:00:00Z',
      memberCount: 10,
      seasonMaxTokensPerPlayer: 20,
      projectedForwardSpend: 40,
      confidence: 'medium',
      secondsRemaining: 172800,
      tokensUsed: 120,
      tokensRemaining: 80,
      seasonBudget: 200,
      projectedWaste: 2,
      playersAtCapRisk: 1,
      finish: {
        stageCode: 'L5',
        loopIndex: 2,
        bossName: 'Mortarion',
        pctIntoFinalStage: 0.4,
        bossesDefeatedForward: 0
      }
    }

    const { container, rerender } = render(
      <SeasonOutlookCard
        forecast={forecast}
        outlook={outlookOne}
        isOfficer={true}
        guildCode="TEST"
      />
    )
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    const outlookMany: SeasonOutlookProjection = {
      ...outlookOne,
      playersAtCapRisk: 3,
      finish: {
        stageCode: 'L5',
        loopIndex: 4,
        bossName: 'Szarekh',
        pctIntoFinalStage: 0.65,
        bossesDefeatedForward: 8
      }
    }

    rerender(
      <SeasonOutlookCard
        forecast={forecast}
        outlook={outlookMany}
        isOfficer={true}
        guildCode="TEST"
      />
    )
    expect(screen.getByTestId('season-outlook-card')).toHaveTextContent(
      'players may cap tokens'
    )
  })

  it('updates BossPerformanceTable and PrimeTargetsCard dynamic badges under translated DOM', () => {
    const initialPerf: MemberBossPerformance = {
      overallVsGuildPct: 5,
      strongestAlternate: null,
      rows: [
        {
          bossName: 'Mortarion',
          encounterId: 0,
          isCurrentTarget: false,
          yourAvg: 200000,
          yourTarget: 190000,
          guildAvg: 185000,
          vsTargetPct: 5,
          vsGuildPct: null,
          battleCount: 0,
          targetSource: 'playbook'
        }
      ]
    }

    const { container, rerender } = render(
      <div>
        <BossPerformanceTable data={initialPerf} seasonNumber="100" />
        <PrimeTargetsCard targets={[makePrimeTarget({ behaviour: 'kill' })]} />
      </div>
    )
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    const updatedPerf: MemberBossPerformance = {
      ...initialPerf,
      strongestAlternate: 'Szarekh',
      rows: [
        {
          ...initialPerf.rows[0]!,
          isCurrentTarget: true,
          vsTargetPct: -4
        }
      ]
    }

    rerender(
      <div>
        <BossPerformanceTable data={updatedPerf} seasonNumber="101" />
        <PrimeTargetsCard
          targets={[
            makePrimeTarget({ behaviour: 'threshold', thresholdHpPct: 35 })
          ]}
        />
      </div>
    )
    expect(screen.getByTestId('prime-targets-card')).toHaveTextContent(
      'Threshold ↓35%'
    )
  })

  it('updates TokenAvailability Full indicator under translated DOM', () => {
    const { container, rerender } = render(
      <TokenAvailability
        hasPlayerApiKey={true}
        guildRaidTokens={{ current: 2, max: 3, nextInSeconds: 1800 }}
      />
    )
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <TokenAvailability
        hasPlayerApiKey={true}
        guildRaidTokens={{ current: 3, max: 3, nextInSeconds: null }}
      />
    )
    expect(container).toHaveTextContent('3/3')
    expect(container).toHaveTextContent('Full')
  })
})
