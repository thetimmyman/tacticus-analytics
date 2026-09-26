import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DamageTrendsChart } from '@/app/components/playerstats/DamageTrendsChart'

const createJsonResponse = (
  data: unknown,
  ok = true,
  status = ok ? 200 : 400
) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'Bad Request',
  json: async () => data
})

vi.mock('@tacticus/ui-kit', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  LoadingSpinner: ({ message }: { message: string }) => <div>{message}</div>
}))

vi.mock('@tacticus/app-core/formatters', () => ({
  formatNumber: vi.fn((value: number) => String(value)),
  formatDamage: vi.fn((value: number) => String(value))
}))

vi.mock('@/app/components/RechartsWrapper', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  BarChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Line: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null
}))

describe('DamageTrendsChart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading state while fetching history', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any

    render(<DamageTrendsChart playerName="Alice" guildCode="TEST" />)

    expect(screen.getByText('Loading damage trends...')).toBeInTheDocument()
  })

  it('renders an error state when the fetch fails', async () => {
    global.fetch = vi.fn(async () =>
      createJsonResponse({ message: 'No history available' }, false, 500)
    ) as any

    render(<DamageTrendsChart playerName="Alice" guildCode="TEST" />)

    expect(await screen.findByText('No history available')).toBeInTheDocument()
  })

  it('renders an empty state when no season data is available', async () => {
    global.fetch = vi.fn(async () =>
      createJsonResponse({
        player_name: 'Alice',
        guild_code: 'TEST',
        seasons: [],
        boss_breakdown: [],
        trends: {
          direction: 'stable',
          change_pct: 0,
          cagr: 0,
          cagr_periods: 0,
          regression_r2: 0,
          trendline_points: [],
          has_enough_data: false
        }
      })
    ) as any

    render(<DamageTrendsChart playerName="Alice" guildCode="TEST" />)

    expect(await screen.findByText('No Historical Data')).toBeInTheDocument()
  })

  it('renders data and toggles to boss view', async () => {
    global.fetch = vi.fn(async () =>
      createJsonResponse({
        player_name: 'Alice',
        guild_code: 'TEST',
        seasons: [
          {
            season: '80',
            total_damage: 100000,
            total_attacks: 10,
            avg_damage_per_attack: 10000,
            bosses_fought: 2,
            best_boss: 'Alpha',
            best_boss_damage: 50000
          },
          {
            season: '81',
            total_damage: 150000,
            total_attacks: 15,
            avg_damage_per_attack: 10000,
            bosses_fought: 2,
            best_boss: 'Beta',
            best_boss_damage: 60000
          }
        ],
        boss_breakdown: [
          {
            season: '80',
            boss_type: 'Alpha',
            avg_damage: 9000,
            total_damage: 90000,
            total_attacks: 9,
            best_damage: 20000
          },
          {
            season: '80',
            boss_type: 'Beta',
            avg_damage: 11000,
            total_damage: 110000,
            total_attacks: 10,
            best_damage: 25000
          },
          {
            season: '81',
            boss_type: 'Alpha',
            avg_damage: 10000,
            total_damage: 100000,
            total_attacks: 10,
            best_damage: 22000
          },
          {
            season: '81',
            boss_type: 'Beta',
            avg_damage: 12000,
            total_damage: 120000,
            total_attacks: 10,
            best_damage: 26000
          }
        ],
        trends: {
          direction: 'improving',
          change_pct: 10,
          cagr: 5,
          cagr_periods: 2,
          regression_r2: 0.9,
          trendline_points: [9000, 10000],
          has_enough_data: true
        }
      })
    ) as any

    render(<DamageTrendsChart playerName="Alice" guildCode="TEST" />)

    await waitFor(() => {
      expect(screen.getByText('Avg Damage per Attack')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('By Boss'))

    expect(screen.getByText('Avg Damage by Boss')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
    expect(screen.getByText('Season Details')).toBeInTheDocument()
  })
})
