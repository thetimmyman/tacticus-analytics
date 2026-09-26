import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OnboardingPage from '@/app/(public)/onboarding/page'

const { getCurrentUserMock, clientPageSpy } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  clientPageSpy: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  getCurrentUser: getCurrentUserMock
}))

vi.mock('@/app/(public)/onboarding/ClientPage', () => ({
  default: (props: { userId?: string }) => {
    clientPageSpy(props)
    return null
  }
}))

describe('Onboarding page wires the authenticated userId to the choice screen', () => {
  it('passes the current user id through for an authenticated, never-onboarded visitor', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 'user-never-onboarded' })

    render(await OnboardingPage())

    expect(clientPageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-never-onboarded' })
    )
  })

  it('negative control: passes no userId for a logged-out visitor', async () => {
    getCurrentUserMock.mockResolvedValue(null)

    render(await OnboardingPage())

    expect(clientPageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined })
    )
  })
})
