import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormErrorBoundary } from '@/app/components/error/FormErrorBoundary'

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
  AlertCircle: () => <svg data-testid="alert-icon" />
}))

describe('FormErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the fallback content with form name', () => {
    render(
      <FormErrorBoundary formName="Signup">
        <div>Child</div>
      </FormErrorBoundary>
    )

    expect(screen.getByText('Signup Error')).toBeInTheDocument()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ formName: 'Signup' }),
      'Form error:'
    )
  })
})
