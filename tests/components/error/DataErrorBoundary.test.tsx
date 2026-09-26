import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataErrorBoundary } from '@/app/components/error/DataErrorBoundary'

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

vi.mock('@tacticus/ui-kit', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  )
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({ error: loggerErrorMock })
}))

vi.mock('lucide-react', () => ({
  AlertCircle: () => <svg data-testid="alert-icon" />,
  RefreshCcw: () => <svg data-testid="refresh-icon" />
}))

describe('DataErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders fallback message and retry action', () => {
    const onRetry = vi.fn()

    render(
      <DataErrorBoundary onRetry={onRetry} fallbackMessage="Custom failure">
        <div>Child</div>
      </DataErrorBoundary>
    )

    expect(screen.getByText('Custom failure')).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retryButton)

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'DataErrorBoundary' }),
      'Data fetch error:'
    )
  })

  it('omits retry action when not provided', () => {
    render(
      <DataErrorBoundary>
        <div>Child</div>
      </DataErrorBoundary>
    )

    expect(screen.getByText('Failed to load data')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
