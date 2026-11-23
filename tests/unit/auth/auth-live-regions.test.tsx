import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  dbClient: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: mocks.dbClient
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}))

vi.mock('@/app/lib/config/constants', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/config/constants')>()
  return {
    ...actual,
    UI_CONFIG: { ...actual.UI_CONFIG, NOTIFICATION_TIMEOUT: 0 }
  }
})

const { default: ForgotPasswordPage } =
  await import('@/app/(auth)/auth/forgot-password/ClientPage')
const { default: ResetPasswordPage } =
  await import('@/app/(auth)/auth/reset-password/ClientPage')
const { default: VerifyEmailPage } =
  await import('@/app/(auth)/auth/verify-email/ClientPage')

describe('auth state-swap live regions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchParams = new URLSearchParams()
  })

  describe('forgot-password', () => {
    it('announces the success state politely once the form is replaced', async () => {
      mocks.dbClient.mockReturnValue({
        auth: {
          resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null })
        }
      })
      render(<ForgotPasswordPage />)

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' }
      })
      fireEvent.submit(screen.getByLabelText(/email address/i).closest('form')!)

      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent(/check your email/i)
      expect(status).toHaveAttribute('aria-live', 'polite')
    })

    it('keeps failures in an alert region', async () => {
      mocks.dbClient.mockReturnValue({
        auth: {
          resetPasswordForEmail: vi
            .fn()
            .mockResolvedValue({ error: new Error('boom') })
        }
      })
      render(<ForgotPasswordPage />)

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'user@example.com' }
      })
      fireEvent.submit(screen.getByLabelText(/email address/i).closest('form')!)

      expect(await screen.findByRole('alert')).toBeInTheDocument()
    })
  })

  describe('reset-password', () => {
    const renderWithSession = (updateUser: ReturnType<typeof vi.fn>) => {
      mocks.searchParams = new URLSearchParams('code=recovery-code')
      mocks.dbClient.mockReturnValue({
        auth: {
          getSession: vi
            .fn()
            .mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }),
          exchangeCodeForSession: vi.fn(),
          updateUser
        }
      })
      return render(<ResetPasswordPage />)
    }

    it('announces a successful reset politely', async () => {
      renderWithSession(vi.fn().mockResolvedValue({ error: null }))

      fireEvent.change(screen.getByLabelText('New Password'), {
        target: { value: 'Ferrum9War!x' }
      })
      fireEvent.change(screen.getByLabelText('Confirm New Password'), {
        target: { value: 'Ferrum9War!x' }
      })
      fireEvent.submit(screen.getByLabelText('New Password').closest('form')!)

      const status = await screen.findByRole('status')
      expect(status).toHaveTextContent(/password reset successful/i)
      expect(status).toHaveAttribute('aria-live', 'polite')
      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith('/auth/login')
      )
    })

    it('announces a failed reset in an alert region', async () => {
      renderWithSession(vi.fn().mockResolvedValue({ error: new Error('nope') }))

      fireEvent.change(screen.getByLabelText('New Password'), {
        target: { value: 'Ferrum9War!x' }
      })
      fireEvent.change(screen.getByLabelText('Confirm New Password'), {
        target: { value: 'Ferrum9War!x' }
      })
      fireEvent.submit(screen.getByLabelText('New Password').closest('form')!)

      expect(await screen.findByRole('alert')).toBeInTheDocument()
    })
  })

  describe('verify-email', () => {
    it('announces a verified email politely after the verifying state', async () => {
      mocks.searchParams = new URLSearchParams('token=abc&type=email')
      mocks.dbClient.mockReturnValue({
        auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) }
      })
      render(<VerifyEmailPage />)

      const status = await screen.findByRole('status')
      expect(await screen.findByText(/email verified/i)).toBeInTheDocument()
      expect(status).toHaveTextContent(/email verified/i)
      expect(status).toHaveAttribute('aria-live', 'polite')
    })

    it('announces a failed verification in an alert region', async () => {
      mocks.searchParams = new URLSearchParams('token=abc&type=email')
      mocks.dbClient.mockReturnValue({
        auth: {
          verifyOtp: vi
            .fn()
            .mockResolvedValue({ error: new Error('bad token') })
        }
      })
      render(<VerifyEmailPage />)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/verification failed/i)
    })
  })
})
