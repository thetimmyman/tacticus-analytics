import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OnboardingChoice from '@/app/(public)/onboarding/ClientPage'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

describe('OnboardingChoice', () => {
  it('privileges the common path and gives every choice persona framing', () => {
    render(<OnboardingChoice />)

    const commonPath = screen.getByRole('link', {
      name: /i'm in a guild already.*join your existing guild.*link my account/i
    })
    expect(commonPath).toHaveAttribute('href', '/onboarding/claim')
    expect(commonPath).toHaveClass('md:col-span-2')
    expect(screen.getByText('Most common')).toBeInTheDocument()

    for (const persona of [
      'I lead a guild',
      'I have an invite code',
      'Just looking'
    ]) {
      expect(screen.getByText(persona)).toBeInTheDocument()
    }
  })

  it('uses each card as the single interactive target', () => {
    const { container } = render(<OnboardingChoice />)
    const choiceLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[href^="/onboarding/"], a[href="/community/roadmap"]'
      )
    )

    expect(choiceLinks).toHaveLength(4)
    for (const link of choiceLinks) {
      expect(link.querySelector('button')).toBeNull()
      expect(link).toHaveClass('focus-visible:ring-2')
    }
  })

  it('includes each visible call to action in its card link accessible name', () => {
    render(<OnboardingChoice />)

    for (const accessibleName of [
      /join your existing guild.*link my account/i,
      /create guild or cluster.*launch leader setup/i,
      /claim your profile.*claim my profile/i,
      /product roadmap.*view roadmap/i
    ]) {
      expect(screen.getByRole('link', { name: accessibleName })).toBeVisible()
    }
  })
})
