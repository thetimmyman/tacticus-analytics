import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let params: URLSearchParams

vi.mock('next/navigation', () => ({
  useSearchParams: () => params
}))
vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({ auth: { resetPasswordForEmail: vi.fn() } })
}))

const { default: ForgotPasswordPage } =
  await import('@/app/(auth)/auth/forgot-password/ClientPage')

describe('forgot-password page — unusable reset link notice', () => {
  beforeEach(() => {
    params = new URLSearchParams()
  })

  it('explains why the reset link failed when the callback sends that reason', () => {
    params = new URLSearchParams('reason=reset_link_unusable')
    render(<ForgotPasswordPage />)

    expect(screen.getByRole('status')).toHaveTextContent(
      /no password was changed[\s\S]*same browser/i
    )
  })

  it('shows no notice for other or missing reasons', () => {
    params = new URLSearchParams('reason=<b>anything</b>')
    render(<ForgotPasswordPage />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
