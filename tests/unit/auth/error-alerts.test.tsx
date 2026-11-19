import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * A failed submit must be announced. A message that appears in a plain div is
 * silent for a screen-reader user, who then hears nothing after pressing the
 * button. Errors shown after the page has loaded need `role="alert"`.
 */

let params = new URLSearchParams()
const getSession = vi.fn()
const exchangeCodeForSession = vi.fn()
const updateUser = vi.fn()
const resetPasswordForEmail = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))
vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: {
      getSession,
      exchangeCodeForSession,
      updateUser,
      resetPasswordForEmail
    }
  })
}))

const { default: ForgotPasswordPage } =
  await import('@/app/(auth)/auth/forgot-password/ClientPage')
const { default: ResetPasswordPage } =
  await import('@/app/(auth)/auth/reset-password/ClientPage')

const SYNTHETIC_PASSPHRASE = 'Synthetic-Passphrase-1!'

// The reset page checks its session once on mount and clears any error when
// that check settles. Submit only after it has, as a visitor would.
async function renderResetPageSettled() {
  const view = render(<ResetPasswordPage />)
  await waitFor(() => expect(getSession).toHaveBeenCalled())
  await act(async () => {
    await Promise.resolve()
  })
  return view
}

describe('auth failures are announced to assistive technology', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    params = new URLSearchParams()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } })
    exchangeCodeForSession.mockResolvedValue({ error: null })
    resetPasswordForEmail.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: null })
  })

  it('forgot password: an invalid email is an alert, not a silent div', async () => {
    const { container } = render(<ForgotPasswordPage />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const email = screen.getByLabelText(/email address/i)
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/email/i)
  })

  it('forgot password: a failed send is an alert', async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: new Error('Synthetic send failure')
    })
    const { container } = render(<ForgotPasswordPage />)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'player@example.com' }
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('reset password: a rejected password is an alert', async () => {
    const { container } = await renderResetPageSettled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const passwords = container.querySelectorAll<HTMLInputElement>(
      'input[type="password"]'
    )
    fireEvent.change(passwords[0], { target: { value: SYNTHETIC_PASSPHRASE } })
    fireEvent.change(passwords[1], { target: { value: 'Different-Value-9!' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('reset password: a failed update is an alert', async () => {
    updateUser.mockResolvedValue({
      error: new Error('Synthetic update failure')
    })
    const { container } = await renderResetPageSettled()

    container
      .querySelectorAll<HTMLInputElement>('input[type="password"]')
      .forEach((input) =>
        fireEvent.change(input, { target: { value: SYNTHETIC_PASSPHRASE } })
      )
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => expect(updateUser).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('reset password: an unusable link announces itself on load', async () => {
    params = new URLSearchParams('code=synthetic-code')
    exchangeCodeForSession.mockResolvedValue({
      error: new Error('Synthetic expired link')
    })
    getSession.mockResolvedValue({ data: { session: null } })

    render(<ResetPasswordPage />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('forgot password: repeating the same failure is announced again', async () => {
    const { container } = render(<ForgotPasswordPage />)
    const form = container.querySelector('form') as HTMLFormElement
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'not-an-email' }
    })

    fireEvent.submit(form)
    const first = await screen.findByRole('alert')
    fireEvent.submit(form)

    // A live region only speaks when its content is inserted or changed, so an
    // identical second failure needs a fresh node.
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
  })

  it('reset password: repeating the same failure is announced again', async () => {
    const { container } = await renderResetPageSettled()
    const form = container.querySelector('form') as HTMLFormElement
    const passwords = container.querySelectorAll<HTMLInputElement>(
      'input[type="password"]'
    )
    fireEvent.change(passwords[0], { target: { value: SYNTHETIC_PASSPHRASE } })
    fireEvent.change(passwords[1], { target: { value: 'Different-Value-9!' } })

    fireEvent.submit(form)
    const first = await screen.findByRole('alert')
    fireEvent.submit(form)

    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
  })
})
