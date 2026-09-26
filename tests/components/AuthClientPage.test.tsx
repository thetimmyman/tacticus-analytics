import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthPage from '@/app/(auth)/auth/ClientPage'

// The "Sign In" mode tab has a distinct aria-label so the button role query matches only the submit.

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn()
    }
  }))
}))

vi.mock('@/app/lib/auth/config', () => ({
  authConfig: {
    redirects: {
      afterLogin: '/home'
    }
  }
}))

vi.mock('@tacticus/ui-kit/radix-switch', () => ({
  RadixSwitch: ({
    checked,
    onCheckedChange,
    id
  }: {
    checked: boolean
    onCheckedChange: (value: boolean) => void
    id: string
  }) => (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      data-testid="remember-me-switch"
    />
  )
}))

vi.mock('@tacticus/ui-kit/radix-tooltip', () => ({
  RadixTooltip: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  RadixTooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  RadixTooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@tacticus/app-core/error-handler', () => ({
  createError: vi.fn((code, message) => ({ code, message })),
  formatErrorForUser: vi.fn((error) => ({
    message: error.message,
    code: error.code,
    version: '1.0.0',
    supportMessage: 'Contact support',
    displayMessage: error.message
  }))
}))

vi.mock('@/app/lib/utils/feature-flags', () => ({
  useFeatureFlag: vi.fn(() => false)
}))

vi.mock('@/app/lib/utils/brand-buttons', () => ({
  brandColors: {
    discord: { primary: '#5865F2', text: '#fff' },
    google: { primary: '#fff', text: '#000' }
  }
}))

describe('AuthPage (/auth) accessible names', () => {
  it('exposes exactly one "Sign In" control: the LoginForm submit button', () => {
    render(<AuthPage />)

    const signInButtons = screen.getAllByRole('button', {
      name: /^sign in$/i
    })
    expect(signInButtons).toHaveLength(1)
    expect(signInButtons[0]).toHaveAttribute('type', 'submit')
  })

  it('gives the login mode-tab a distinct accessible name from its visible "Sign In" text', () => {
    render(<AuthPage />)

    const loginTab = screen.getByRole('tab', {
      name: /show the login form/i
    })
    expect(loginTab).toHaveTextContent('Sign In')
    expect(loginTab).not.toHaveAccessibleName(/^sign in$/i)
  })

  it('gives the create-account tab a distinct accessible name from its visible text too', () => {
    render(<AuthPage />)

    const signupTab = screen.getByRole('tab', {
      name: /switch to the create account tab/i
    })
    expect(signupTab).toHaveTextContent('Create Account')
  })
})
