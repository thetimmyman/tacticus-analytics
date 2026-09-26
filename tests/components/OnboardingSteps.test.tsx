import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OnboardingSteps } from '@/app/(public)/onboarding/_components/OnboardingSteps'

describe('OnboardingSteps', () => {
  it('announces completed, current, and upcoming steps', () => {
    render(
      <OnboardingSteps
        steps={['Choose path', 'Link account', 'Done']}
        currentIndex={1}
      />
    )

    expect(
      screen.getByRole('list', { name: 'Onboarding progress' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', { name: 'Choose path, completed' })
    ).not.toHaveAttribute('aria-current')
    expect(
      screen.getByRole('listitem', {
        name: 'Link account, current step'
      })
    ).toHaveAttribute('aria-current', 'step')
    expect(
      screen.getByRole('listitem', { name: 'Done, upcoming' })
    ).not.toHaveAttribute('aria-current')
  })

  it('keeps the current label visible at mobile widths', () => {
    render(
      <OnboardingSteps
        steps={['Choose path', 'Link account', 'Done']}
        currentIndex={1}
      />
    )

    const currentVisualLabel = screen
      .getAllByText('Link account')
      .find((element) => element.getAttribute('aria-hidden') === 'true')
    const upcomingVisualLabel = screen
      .getAllByText('Done')
      .find((element) => element.getAttribute('aria-hidden') === 'true')

    expect(currentVisualLabel).toHaveClass('inline')
    expect(currentVisualLabel).not.toHaveClass('hidden')
    expect(upcomingVisualLabel).toHaveClass('hidden', 'sm:inline')
  })
})
