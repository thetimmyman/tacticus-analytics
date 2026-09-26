import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PlayerMapping } from '@tacticus/app-core/types'
import DashboardThemeWrapper from '@/app/(dashboard)/DashboardThemeWrapper'

let receivedProfile: PlayerMapping | null = null

vi.mock('@/app/components/ThemeProvider', () => ({
  ThemeProvider: ({
    children,
    profile
  }: {
    children: React.ReactNode
    profile: PlayerMapping
  }) => {
    receivedProfile = profile
    return <div data-testid="theme-provider">{children}</div>
  }
}))

describe('DashboardThemeWrapper', () => {
  it('passes profile through to ThemeProvider', () => {
    const profile = { guild_code: 'TEST' } as PlayerMapping

    render(
      <DashboardThemeWrapper profile={profile}>
        <span>Dashboard child</span>
      </DashboardThemeWrapper>
    )

    expect(screen.getByTestId('theme-provider')).toBeInTheDocument()
    expect(screen.getByText('Dashboard child')).toBeInTheDocument()
    expect(receivedProfile).toBe(profile)
  })
})
