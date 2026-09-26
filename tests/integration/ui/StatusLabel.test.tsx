import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/tests/utils'
import { ConnectionStatus, StatusLabel } from '@tacticus/ui-kit'

describe('StatusLabel component integration', () => {
  it('renders badge content with the expected styling', () => {
    renderWithProviders(
      <StatusLabel type="success" size="md" pulse className="custom-class">
        System Healthy
      </StatusLabel>
    )

    const badge = screen.getByText('System Healthy')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass(
      'bg-[color-mix(in_srgb,var(--success)_20%,transparent)]'
    )
    expect(badge).toHaveClass('animate-pulse')
    expect(badge).toHaveClass('custom-class')
  })

  it('shows connection status label and indicator', () => {
    renderWithProviders(<ConnectionStatus status="error" />)

    const badge = screen.getByText('Error')
    expect(badge).toBeInTheDocument()
    expect(badge.querySelector('span')).toHaveClass('bg-[var(--danger)]')
  })

  it('supports dot-only rendering while preserving pulse animation', () => {
    const { container } = renderWithProviders(
      <ConnectionStatus status="connecting" showLabel={false} />
    )

    const dot = container.querySelector('span')
    expect(dot).not.toBeNull()
    expect(dot).toHaveClass('animate-pulse')
    expect(dot).toHaveClass('bg-[var(--warning)]')
  })
})
