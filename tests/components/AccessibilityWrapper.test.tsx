import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  AccessibilityWrapper,
  ButtonAccessibilityWrapper
} from '@/app/components/ui/AccessibilityWrapper'

vi.mock('@tacticus/ui-kit', () => ({
  TooltipWrapper: ({
    children,
    tooltip,
    position
  }: {
    children: React.ReactNode
    tooltip: string
    position: string
  }) => (
    <div data-testid="tooltip" data-tooltip={tooltip} data-position={position}>
      {children}
    </div>
  )
}))

describe('AccessibilityWrapper', () => {
  it('wraps content with tooltip when provided', () => {
    render(
      <AccessibilityWrapper tooltip="Helpful hint" tooltipPosition="bottom">
        <span>Content</span>
      </AccessibilityWrapper>
    )

    const tooltip = screen.getByTestId('tooltip')
    expect(tooltip).toHaveAttribute('data-tooltip', 'Helpful hint')
    expect(tooltip).toHaveAttribute('data-position', 'bottom')
  })

  it('focuses the first focusable element on mount', async () => {
    render(
      <AccessibilityWrapper focusOnMount>
        <button type="button">Click Me</button>
      </AccessibilityWrapper>
    )

    const button = screen.getByRole('button', { name: 'Click Me' })
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('triggers button click on Enter key when wrapper is focused', () => {
    const onClick = vi.fn()
    const { container } = render(
      <AccessibilityWrapper role="button" tabIndex={0}>
        <button type="button" onClick={onClick}>
          Action
        </button>
      </AccessibilityWrapper>
    )

    const wrapper = container.firstChild as HTMLElement
    fireEvent.keyDown(wrapper, { key: 'Enter' })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('ButtonAccessibilityWrapper', () => {
  it('adds default tooltip for disabled buttons', () => {
    render(
      <ButtonAccessibilityWrapper disabled>
        <button type="button">Disabled</button>
      </ButtonAccessibilityWrapper>
    )

    const tooltip = screen.getByTestId('tooltip')
    expect(tooltip).toHaveAttribute(
      'data-tooltip',
      'This button is currently disabled'
    )
  })

  it('updates aria-label when loading', () => {
    render(
      <ButtonAccessibilityWrapper
        loading
        ariaLabel="Save"
        loadingText="Processing"
      >
        <button type="button">Save</button>
      </ButtonAccessibilityWrapper>
    )

    expect(screen.getByLabelText('Save - Processing')).toBeInTheDocument()
  })
})
