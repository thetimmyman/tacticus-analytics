import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthThemeWrapper from '@/app/(auth)/AuthThemeWrapper'

vi.mock('@/app/components/PublicThemeProvider', () => ({
  PublicThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="public-theme-provider">{children}</div>
  )
}))

describe('AuthThemeWrapper', () => {
  it('wraps children with the public theme provider', () => {
    render(
      <AuthThemeWrapper>
        <span>Auth child</span>
      </AuthThemeWrapper>
    )

    expect(screen.getByTestId('public-theme-provider')).toBeInTheDocument()
    expect(screen.getByText('Auth child')).toBeInTheDocument()
  })
})
