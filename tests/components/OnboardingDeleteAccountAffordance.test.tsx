import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OnboardingChoice from '@/app/(public)/onboarding/ClientPage'

// A fresh account is redirected here from /profile, so delete must be offered.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) }
  })
}))

describe('Onboarding choice screen delete-account affordance', () => {
  it('shows the affordance for a never-onboarded authenticated visitor', () => {
    render(<OnboardingChoice userId="user-never-onboarded" />)

    expect(
      screen.getByRole('button', { name: 'Delete Account' })
    ).toBeInTheDocument()
  })

  it('opens the same confirmation dialog as the profile page on click', () => {
    render(<OnboardingChoice userId="user-never-onboarded" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }))

    expect(
      screen.getByText(
        /This action cannot be undone\. This will permanently delete your account/i
      )
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type DELETE')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Permanently Delete' })
    ).toBeDisabled()
  })

  it('negative control: does not render the affordance for a logged-out visitor', () => {
    render(<OnboardingChoice />)

    expect(
      screen.queryByRole('button', { name: 'Delete Account' })
    ).not.toBeInTheDocument()
  })
})
