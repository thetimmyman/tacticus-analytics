import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { forwardRef } from 'react'
import SimplifiedSignupForm from '@/app/(auth)/auth/signup/SimplifiedSignupForm'

const mockPush = vi.fn()
let mockSignUp: AnyMock

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush
  })
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args)
    }
  })
}))

vi.mock('@tacticus/ui-kit', () => ({
  Button: forwardRef<HTMLButtonElement, any>(
    ({ loading, loadingText, children, ...props }, ref) => (
      <button ref={ref} {...props}>
        {loading && loadingText ? loadingText : children}
      </button>
    )
  ),
  Input: (props: any) => <input {...props} />,
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  )
}))

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="alert-icon" />,
  CheckCircle2: () => <span data-testid="check-icon" />
}))

const fillRequiredFields = () => {
  fireEvent.change(screen.getByLabelText(/display name/i), {
    target: { value: 'Test User' }
  })
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: 'test@example.com' }
  })
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'Ferrum9War!x' }
  })
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: 'Ferrum9War!x' }
  })
}

describe('SimplifiedSignupForm', () => {
  beforeEach(() => {
    mockSignUp = vi.fn()
    mockPush.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders required fields and submit button', () => {
    render(<SimplifiedSignupForm />)

    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create account/i })
    ).toBeInTheDocument()
  })

  it('validates missing display name', async () => {
    render(<SimplifiedSignupForm />)

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'Ferrum9War!x' }
    })
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'Ferrum9War!x' }
    })

    const form = screen
      .getByRole('button', { name: /create account/i })
      .closest('form')
    fireEvent.submit(form as HTMLFormElement)

    expect(
      await screen.findByText('Display name is required.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/display name/i)).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(screen.getByLabelText(/display name/i)).toHaveAttribute(
      'aria-errormessage',
      'displayName-error'
    )
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('validates password mismatch', async () => {
    render(<SimplifiedSignupForm />)

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Test User' }
    })
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'Ferrum9War!x' }
    })
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'Different123' }
    })

    const form = screen
      .getByRole('button', { name: /create account/i })
      .closest('form')
    fireEvent.submit(form as HTMLFormElement)

    expect(
      await screen.findByText('Passwords do not match.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(form).not.toHaveAttribute('aria-live')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(mockSignUp).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'Different123' }
    })

    expect(screen.queryByText('Passwords do not match.')).toBeNull()
    expect(screen.getByLabelText(/confirm password/i)).not.toHaveAttribute(
      'aria-invalid'
    )
  })

  it('validates password length', async () => {
    render(<SimplifiedSignupForm />)

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'Test User' }
    })
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'short' }
    })
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'short' }
    })

    const form = screen
      .getByRole('button', { name: /create account/i })
      .closest('form')
    fireEvent.submit(form as HTMLFormElement)

    expect(
      await screen.findByText('Password must be at least 12 characters')
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when a session is returned', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null
    })

    render(<SimplifiedSignupForm />)
    fillRequiredFields()

    const form = screen
      .getByRole('button', { name: /create account/i })
      .closest('form')
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalled()
    })

    expect(mockPush).toHaveBeenCalledWith('/onboarding')
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'Ferrum9War!x',
      options: {
        data: {
          display_name: 'Test User',
          role: 'onboarding'
        }
      }
    })
  })

  it('shows confirmation prompt when session is not returned', async () => {
    vi.useFakeTimers()
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: null
    })

    render(<SimplifiedSignupForm />)
    fillRequiredFields()

    const form = screen
      .getByRole('button', { name: /create account/i })
      .closest('form')
    fireEvent.submit(form as HTMLFormElement)

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByText(/check your inbox for a confirmation email/i)
    ).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    const signInButton = screen.getByRole('button', { name: /go to sign in/i })
    expect(signInButton).toBeInTheDocument()

    expect(signInButton).toHaveFocus()
    fireEvent.click(signInButton)

    expect(mockPush).toHaveBeenCalledWith('/auth/login')
  })

  it('shows error when signup fails', async () => {
    mockSignUp.mockResolvedValue({
      data: null,
      error: new Error('Signup failed')
    })

    render(<SimplifiedSignupForm />)
    fillRequiredFields()

    const form = screen
      .getByRole('button', { name: /create account/i })
      .closest('form')
    fireEvent.submit(form as HTMLFormElement)

    expect(await screen.findByText('Signup failed')).toBeInTheDocument()
  })
})
