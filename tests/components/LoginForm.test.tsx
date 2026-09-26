import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import LoginForm from '@/app/components/auth/LoginForm'

const mockSignInWithPassword = vi.fn()
const mockSignInWithOAuth = vi.fn()
const mockFetch = vi.fn()
const searchParams = vi.hoisted(() => ({ current: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams.current,
  usePathname: () => '/auth/login'
}))

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
      signInWithPassword: mockSignInWithPassword,
      signInWithOAuth: mockSignInWithOAuth
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
  RadixSwitch: ({ checked, onCheckedChange, id }: any) => (
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

vi.mock('@/app/components/ui/LinkifiedText', () => ({
  LinkifiedText: ({ text }: { text: string }) => <span>{text}</span>
}))

vi.mock('@/app/lib/utils/feature-flags', () => ({
  useFeatureFlag: vi.fn((flag) => {
    if (flag === 'discordAuth') return true
    if (flag === 'googleAuth') return true
    return false
  })
}))

vi.mock('@/app/lib/utils/brand-buttons', () => ({
  brandColors: {
    discord: { primary: '#5865F2', text: '#fff' },
    google: { primary: '#fff', text: '#000' }
  }
}))

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'user-123' },
        session: { access_token: 'test-token' }
      },
      error: null
    })
    mockSignInWithOAuth.mockResolvedValue({ error: null })
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: { id: 'user-123' } })
    })
    vi.stubGlobal('fetch', mockFetch)
    delete (window as any).location
    window.location = { href: '' } as any
  })

  it('renders login form with all fields', () => {
    render(<LoginForm />)

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders welcome heading', () => {
    render(<LoginForm />)
    expect(screen.getByText('Welcome Back')).toBeInTheDocument()
  })

  it('renders remember me switch', () => {
    render(<LoginForm />)
    expect(screen.getByTestId('remember-me-switch')).toBeInTheDocument()
  })

  it('renders forgot password link', () => {
    render(<LoginForm />)
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument()
  })

  it('renders signup link', () => {
    render(<LoginForm />)
    expect(screen.getByText(/create an account/i)).toBeInTheDocument()
  })

  it('handles email input', () => {
    render(<LoginForm />)
    const emailInput = screen.getByLabelText(/email address/i)
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
    expect(emailInput).toHaveValue('test@example.com')
  })

  it('handles password input', () => {
    render(<LoginForm />)
    const passwordInput = screen.getByLabelText(/password/i)
    fireEvent.change(passwordInput, { target: { value: 'password123' } })
    expect(passwordInput).toHaveValue('password123')
  })

  it('toggles remember me switch', () => {
    render(<LoginForm />)
    const rememberMeSwitch = screen.getByTestId('remember-me-switch')

    expect(rememberMeSwitch).toBeChecked()
    fireEvent.click(rememberMeSwitch)
    expect(rememberMeSwitch).not.toBeChecked()
  })

  it('submits form with valid credentials', async () => {
    render(<LoginForm />)

    const emailInput = screen.getByLabelText(/email address/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123',
            rememberMe: true
          })
        })
      )
    })
  })

  it('displays error on login failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({ error: { message: 'Invalid login credentials' } })
    })

    render(<LoginForm />)

    const emailInput = screen.getByLabelText(/email address/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    })
  })

  it('shows loading state during submission', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))

    render(<LoginForm />)

    const emailInput = screen.getByLabelText(/email address/i)
    const passwordInput = screen.getByLabelText(/password/i)
    const submitButton = screen.getByRole('button', { name: /sign in/i })

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /signing in/i })
      ).toBeInTheDocument()
    })

    const loadingButton = screen.getByRole('button', { name: /signing in/i })
    const tooltipRoot = loadingButton.parentElement?.parentElement
    expect(tooltipRoot).toHaveClass('relative', 'inline-block')
    expect(tooltipRoot?.parentElement).toHaveClass('grid', 'w-full')
  })

  it('renders OAuth buttons when enabled', () => {
    render(<LoginForm />)
    expect(screen.getByText(/continue with discord/i)).toBeInTheDocument()
    expect(screen.getByText(/continue with google/i)).toBeInTheDocument()
  })

  it('renders privacy and terms links', () => {
    render(<LoginForm />)
    expect(screen.getByText('Terms')).toBeInTheDocument()
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument()
  })

  describe('PS-245 timeout and error-visibility regression coverage', () => {
    const TEST_TIMEOUT_MS = 1000

    it('re-enables the submit button and shows a timeout error when the sign-in request never resolves', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        mockFetch.mockImplementation(() => new Promise(() => {}))

        render(<LoginForm timeoutMs={TEST_TIMEOUT_MS} />)

        const emailInput = screen.getByLabelText(/email address/i)
        const passwordInput = screen.getByLabelText(/password/i)
        fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
        fireEvent.change(passwordInput, { target: { value: 'password123' } })
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

        await waitFor(() => {
          expect(
            screen.getByRole('button', { name: /signing in/i })
          ).toBeInTheDocument()
        })

        await act(async () => {
          await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS + 100)
        })

        await waitFor(() => {
          expect(
            screen.getByRole('button', { name: /^sign in$/i })
          ).toBeEnabled()
        })
        expect(screen.getByText(/sign-in timed out/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/email address/i)).toHaveValue(
          'test@example.com'
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('shows an error and re-enables the button on a rejected 401 (wrong password)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ error: { message: 'Invalid login credentials' } })
      })

      render(<LoginForm />)

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'test@example.com' }
      })
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'wrongpassword' }
      })
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(
          screen.getByText(/invalid email or password/i)
        ).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
    })

    it('shows an error and re-enables the button on the measured 403 "Request blocked" shape', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { message: 'Request blocked' } })
      })

      render(<LoginForm />)

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'test@example.com' }
      })
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'password123' }
      })
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(screen.getByText(/request blocked/i)).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
    })

    it('still redirects on success unchanged', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            user: { id: 'user-123' },
            session: { access_token: 'test-token' }
          })
      })

      render(<LoginForm />)

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'test@example.com' }
      })
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'password123' }
      })
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() => {
        expect(window.location.href).toBe('/home')
      })
    })

    it.each([
      ['/\\evil.com'],
      ['//evil.com'],
      ['%2F%2Fevil.com'],
      ['https://evil.com']
    ])(
      'ignores an off-site redirectTo (%s) and uses the default',
      async (target) => {
        searchParams.current = new URLSearchParams({ redirectTo: target })
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              user: { id: 'user-123' },
              session: { access_token: 'test-token' }
            })
        })

        render(<LoginForm />)
        fireEvent.change(screen.getByLabelText(/email address/i), {
          target: { value: 'test@example.com' }
        })
        fireEvent.change(screen.getByLabelText(/password/i), {
          target: { value: 'password123' }
        })
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

        await waitFor(() => {
          expect(window.location.href).toBe('/home')
        })
        searchParams.current = new URLSearchParams()
      }
    )

    it('re-enables a stalled OAuth button after the timeout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        mockSignInWithOAuth.mockImplementation(() => new Promise(() => {}))

        render(<LoginForm timeoutMs={TEST_TIMEOUT_MS} />)

        fireEvent.click(screen.getByText(/continue with discord/i))

        await act(async () => {
          await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS + 100)
        })

        await waitFor(() => {
          expect(
            screen.getByText(/continue with discord/i).closest('button')
          ).toBeEnabled()
        })
        expect(screen.getByText(/sign-in timed out/i)).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
