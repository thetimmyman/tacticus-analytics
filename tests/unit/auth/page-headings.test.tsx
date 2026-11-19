import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Every sign-in-flow screen must expose one page title (`h1`) and a heading
 * outline that never skips a level, in each state the visitor can reach.
 * Screen-reader users jump between pages by the top heading and by level, so a
 * page whose title is an `h2` (or has none) reads as an unnamed region.
 */

let params = new URLSearchParams()
const getSession = vi.fn()
const exchangeCodeForSession = vi.fn()
const updateUser = vi.fn()
const verifyOtp = vi.fn()
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
      verifyOtp,
      resetPasswordForEmail
    }
  })
}))
vi.mock('@/app/lib/utils/feature-flags', () => ({
  useFeatureFlag: () => false
}))

const { RadixTooltipProvider } = await import('@tacticus/ui-kit/radix-tooltip')
const { default: LoginForm } = await import('@/app/components/auth/LoginForm')
const { default: AuthPage } = await import('@/app/(auth)/auth/ClientPage')
const { default: ForgotPasswordPage } =
  await import('@/app/(auth)/auth/forgot-password/ClientPage')
const { default: VerifyEmailPage } =
  await import('@/app/(auth)/auth/verify-email/ClientPage')
const { default: ResetPasswordPage } =
  await import('@/app/(auth)/auth/reset-password/ClientPage')

// The sign-in form's "Remember me" tooltip needs the provider the auth layout supplies.
function renderLogin() {
  return render(
    <RadixTooltipProvider>
      <LoginForm />
    </RadixTooltipProvider>
  )
}

function outline(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
  ).map((heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: heading.textContent?.trim() ?? ''
  }))
}

function expectSingleTitleAndNoSkippedLevels(container: HTMLElement) {
  const headings = outline(container)
  const levels = headings.map((heading) => heading.level)

  expect(levels.filter((level) => level === 1)).toHaveLength(1)
  expect(levels[0]).toBe(1)
  levels.slice(1).forEach((level, index) => {
    expect(
      level - levels[index],
      `${headings[index + 1].text} jumps from h${levels[index]} to h${level}`
    ).toBeLessThanOrEqual(1)
  })
}

describe('auth screens expose one h1 and a gap-free heading outline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    params = new URLSearchParams()
    getSession.mockResolvedValue({ data: { session: null } })
    exchangeCodeForSession.mockResolvedValue({ error: null })
    verifyOtp.mockResolvedValue({ error: null })
    resetPasswordForEmail.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: null })
  })

  it('sign in names the page with an h1', () => {
    const { container } = renderLogin()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome Back' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(container)
  })

  it('sign in keeps one h1 when a redirect reason banner is shown', () => {
    params = new URLSearchParams('reason=expired')
    const { container } = renderLogin()

    expectSingleTitleAndNoSkippedLevels(container)
  })

  it('combined /auth page: one h1 on the sign-in and the create-account tab', () => {
    const { container } = render(
      <RadixTooltipProvider>
        <AuthPage />
      </RadixTooltipProvider>
    )

    // The page owns the h1; the embedded sign-in form titles itself one level down.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tacticus Analytics' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Welcome Back' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(container)

    fireEvent.click(screen.getByRole('tab', { name: /create account/i }))
    expectSingleTitleAndNoSkippedLevels(container)
  })

  it('forgot password: form and confirmation', async () => {
    const { container } = render(<ForgotPasswordPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Forgot Password?' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(container)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'player@example.com' }
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Check Your Email' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(container)
  })

  it('verify email: verifying, verified and failed', async () => {
    params = new URLSearchParams('token=synthetic-token&type=email')
    let finishVerification: (value: { error: null }) => void = () => {}
    verifyOtp.mockReturnValueOnce(
      new Promise((resolve) => {
        finishVerification = resolve
      })
    )
    const verifying = render(<VerifyEmailPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Email Verification' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(verifying.container)

    finishVerification({ error: null })
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Email Verified!' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(verifying.container)
    verifying.unmount()

    params = new URLSearchParams()
    const failed = render(<VerifyEmailPage />)
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Verification Failed'
      })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(failed.container)
  })

  it('reset password: form and success', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } })
    const { container } = render(<ResetPasswordPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Reset Your Password' })
    ).toBeInTheDocument()
    expectSingleTitleAndNoSkippedLevels(container)

    const passwords = container.querySelectorAll<HTMLInputElement>(
      'input[type="password"]'
    )
    const synthetic = 'Synthetic-Passphrase-1!'
    passwords.forEach((input) =>
      fireEvent.change(input, { target: { value: synthetic } })
    )
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'Password Reset Successful!'
        })
      ).toBeInTheDocument()
    )
    expectSingleTitleAndNoSkippedLevels(container)
  })
})
