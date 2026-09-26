import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PerformanceControls } from '@/app/components/performance/PerformanceControls'
import type {
  CompareMode,
  PerformanceMode,
  TokenWeightingMode
} from '@/app/components/performance/types'
import type { Rarity } from '@tacticus/app-core/rarity-utils'

vi.mock('@/app/components/filters/RarityFilterControls', () => ({
  RarityFilterControls: ({ label }: { label: string }) => <div>{label}</div>
}))

const buildProps = (
  overrides: Partial<React.ComponentProps<typeof PerformanceControls>> = {}
) => ({
  availableRarities: ['Legendary', 'Mythic'] as Rarity[],
  selectedRarities: ['Legendary'] as Rarity[],
  onRarityChange: vi.fn(),
  hideInactivePlayers: false,
  hiddenPlayerCount: 0,
  onHideInactiveChange: vi.fn(),
  hasCluster: false,
  compareMode: 'guild' as CompareMode,
  onCompareModeChange: vi.fn(),
  performanceMode: 'battle-weighted' as PerformanceMode,
  onPerformanceModeChange: vi.fn(),
  tokenModeAvailable: false,
  tokenWeightingMode: 'max' as TokenWeightingMode,
  onTokenWeightingModeChange: vi.fn(),
  tokenModeUsesApproximation: false,
  showBossDetail: false,
  onShowBossDetailChange: vi.fn(),
  showFiveSeasonAverage: false,
  onShowFiveSeasonAverageChange: vi.fn(),
  ...overrides
})

describe('PerformanceControls', () => {
  it('disables token weighting when unavailable', () => {
    const props = buildProps()

    render(<PerformanceControls {...props} />)

    const tokenButton = screen.getByRole('button', { name: 'Token Weighting' })
    expect(tokenButton).toBeDisabled()
    fireEvent.click(tokenButton)
    expect(props.onPerformanceModeChange).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Token weighting will activate once season token stats are available.'
      )
    ).toBeInTheDocument()
  })

  it('renders token baseline controls when token mode is active', () => {
    const props = buildProps({
      hasCluster: true,
      compareMode: 'cluster',
      performanceMode: 'token-weighted',
      tokenModeAvailable: true,
      tokenModeUsesApproximation: true
    })

    render(<PerformanceControls {...props} />)

    expect(
      screen.getByText(
        'Until season token stats arrive, token weighting uses participation share as an approximation.'
      )
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Max Cluster Tokens Possible' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'Average Cluster Tokens Spent' })
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('button', { name: 'Compare to Cluster' })
    ).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(
      screen.getByRole('button', { name: 'Average Cluster Tokens Spent' })
    )
    expect(props.onTokenWeightingModeChange).toHaveBeenCalledWith('average')

    fireEvent.click(screen.getByRole('button', { name: 'Compare to Cluster' }))
    expect(props.onCompareModeChange).toHaveBeenCalledWith('cluster')
  })

  it('handles filter and detail toggles', () => {
    const props = buildProps({
      hideInactivePlayers: true,
      hiddenPlayerCount: 3,
      showBossDetail: false,
      showFiveSeasonAverage: true
    })

    render(<PerformanceControls {...props} />)

    expect(screen.getByText('Rarity Filter')).toBeInTheDocument()
    expect(screen.getByText('3 hidden')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Hide inactive members'))
    expect(props.onHideInactiveChange).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByLabelText('Show Boss-by-Boss Detail'))
    expect(props.onShowBossDetailChange).toHaveBeenCalledWith(true)

    fireEvent.click(
      screen.getByLabelText('Show 5-Season Averages (Not Including Current)')
    )
    expect(props.onShowFiveSeasonAverageChange).toHaveBeenCalledWith(false)
  })

  it('renders target loop range controls when target weighting has loop data', () => {
    const props = buildProps({
      performanceMode: 'target-weighted',
      targetLoopRange: {
        availableLoops: [0, 1, 2],
        start: 0,
        end: 2
      },
      onTargetLoopRangeChange: vi.fn()
    })

    render(<PerformanceControls {...props} />)

    expect(screen.getAllByText('Loop Range').length).toBeGreaterThan(0)
    expect(screen.getByText('Loops 1-3')).toBeInTheDocument()

    const firstLoop = screen.getByRole('slider', { name: 'From target loop' })
    const lastLoop = screen.getByRole('slider', { name: 'To target loop' })
    expect(firstLoop).toHaveAttribute('min', '1')
    expect(firstLoop).toHaveAttribute('max', '3')
    expect(firstLoop).toHaveValue('1')
    expect(lastLoop).toHaveValue('3')

    fireEvent.change(firstLoop, {
      target: { value: '2' }
    })
    expect(props.onTargetLoopRangeChange).toHaveBeenCalledWith(1, 2)

    fireEvent.change(lastLoop, {
      target: { value: '2' }
    })
    expect(props.onTargetLoopRangeChange).toHaveBeenCalledWith(0, 1)
  })

  it('snaps sparse target loop slider values to available loops', () => {
    const props = buildProps({
      performanceMode: 'target-weighted',
      targetLoopRange: {
        availableLoops: [0, 2],
        start: 0,
        end: 2
      },
      onTargetLoopRangeChange: vi.fn()
    })

    render(<PerformanceControls {...props} />)

    const firstLoop = screen.getByRole('slider', { name: 'From target loop' })
    const lastLoop = screen.getByRole('slider', { name: 'To target loop' })

    fireEvent.change(firstLoop, {
      target: { value: '2' }
    })
    expect(props.onTargetLoopRangeChange).toHaveBeenCalledWith(2, 2)

    fireEvent.change(lastLoop, {
      target: { value: '2' }
    })
    expect(props.onTargetLoopRangeChange).toHaveBeenCalledWith(0, 0)
  })

  it('hides target loop controls outside target mode or with only one loop', () => {
    const range = {
      availableLoops: [0, 1],
      start: 0,
      end: 1
    }

    const { rerender } = render(
      <PerformanceControls
        {...buildProps({
          performanceMode: 'battle-weighted',
          targetLoopRange: range,
          onTargetLoopRangeChange: vi.fn()
        })}
      />
    )

    expect(screen.queryByText('Loop Range')).not.toBeInTheDocument()

    rerender(
      <PerformanceControls
        {...buildProps({
          performanceMode: 'target-weighted',
          targetLoopRange: {
            availableLoops: [0],
            start: 0,
            end: 0
          },
          onTargetLoopRangeChange: vi.fn()
        })}
      />
    )

    expect(screen.queryByText('Loop Range')).not.toBeInTheDocument()
  })

  it('describes target weighting as a raw score', () => {
    render(<PerformanceControls {...buildProps()} />)

    expect(
      screen.getByRole('button', { name: 'Target Weighting' })
    ).toHaveAttribute(
      'title',
      'Ratio of actual damage to expected damage per token (boss HP ÷ anticipated tokens). A score of 1.0 is on target.'
    )
  })

  it('announces the selected scoring basis', () => {
    render(
      <PerformanceControls
        {...buildProps({
          performanceMode: 'target-weighted'
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Target Weighting' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'Battle Weighting' })
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
