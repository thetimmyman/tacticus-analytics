import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartErrorBoundary } from '@/app/components/error/ChartErrorBoundary'

const loggerErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/error/ErrorBoundary', () => ({
  ErrorBoundary: ({
    fallback,
    onError
  }: {
    fallback: ReactNode
    onError?: (error: Error, errorInfo: { componentStack?: string }) => void
  }) => {
    onError?.(new Error('Boom'), { componentStack: 'stack' })
    return <div data-testid="error-boundary">{fallback}</div>
  }
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({ error: loggerErrorMock })
}))

vi.mock('lucide-react', () => ({
  BarChart3: () => <svg data-testid="chart-icon" />
}))

describe('ChartErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chart-specific fallback content', () => {
    render(
      <ChartErrorBoundary chartName="Damage Chart">
        <div>Child</div>
      </ChartErrorBoundary>
    )

    expect(screen.getByText('Damage Chart Unavailable')).toBeInTheDocument()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ chartName: 'Damage Chart' }),
      'Chart rendering error:'
    )
  })
})
