import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginPage from '@/app/(auth)/auth/login/page'

vi.mock('@/app/components/auth/LoginForm', () => ({
  default: () => <div data-testid="login-form">Login form</div>
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  LoadingSpinner: ({ message }: { message?: string }) => (
    <div data-testid="loading-spinner">{message}</div>
  )
}))

describe('LoginPage', () => {
  it('renders the login form', () => {
    render(<LoginPage />)

    expect(screen.getByTestId('login-form')).toBeInTheDocument()
  })
})
