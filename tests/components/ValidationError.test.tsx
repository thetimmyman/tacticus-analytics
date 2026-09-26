import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ValidationError } from '@/app/components/ui/ValidationError'

describe('ValidationError', () => {
  it('returns null when message is empty', () => {
    const { container } = render(<ValidationError message="" />)

    expect(container.firstChild).toBeNull()
  })

  it('renders an addressable live alert', () => {
    render(<ValidationError id="email-error" message="Email is invalid" />)

    expect(screen.getByRole('alert')).toHaveAttribute('id', 'email-error')
  })

  it('renders suggestion details and handles actions', () => {
    const primaryAction = vi.fn()
    const secondaryAction = vi.fn()

    render(
      <ValidationError
        message="Something went wrong"
        suggestion={{
          type: 'guidance',
          title: 'Next steps',
          description: 'Try again or check the docs.',
          actions: [
            { text: 'Retry', type: 'primary', action: primaryAction },
            { text: 'Docs', type: 'secondary', action: secondaryAction }
          ]
        }}
      />
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Next steps')).toBeInTheDocument()
    expect(screen.getByText('Try again or check the docs.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }))

    expect(primaryAction).toHaveBeenCalledTimes(1)
    expect(secondaryAction).toHaveBeenCalledTimes(1)
  })
})
