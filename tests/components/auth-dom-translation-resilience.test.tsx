import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Button } from '@tacticus/ui-kit'
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
  RadixSwitch: ({
    checked,
    onCheckedChange,
    id
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    id: string
  }) => (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
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
  createError: vi.fn((code: string, message: string) => ({ code, message })),
  formatErrorForUser: vi.fn((error: { code: string; message: string }) => ({
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
  useFeatureFlag: vi.fn((flag: string) => {
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

/**
 * Mirrors browser page-translation DOM mutations (wrapping non-empty text
 * nodes inside nested <font> elements, which detaches them as direct children
 * of their original element parent).
 */
function simulateBrowserTranslation(root: Element): number {
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    const textNode = current as Text
    const parent = textNode.parentElement
    if (
      textNode.nodeValue &&
      textNode.nodeValue.trim().length > 0 &&
      parent &&
      parent.tagName.toLowerCase() !== 'font'
    ) {
      textNodes.push(textNode)
    }
    current = walker.nextNode()
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentNode
    if (!parent) continue
    const outerFont = document.createElement('font')
    const innerFont = document.createElement('font')
    parent.replaceChild(outerFont, textNode)
    outerFont.appendChild(innerFont)
    innerFont.appendChild(textNode)
  }

  return textNodes.length
}

describe('DOM translation resilience for interactive buttons and auth forms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams.current = new URLSearchParams()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('transitions Button loading state cleanly when browser translation wraps bare text nodes', () => {
    const { container, rerender } = render(
      <div className="grid w-full">
        <Button loading={false} loadingText="Signing in...">
          Sign In
        </Button>
      </div>
    )

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <div className="grid w-full">
        <Button loading={true} loadingText="Signing in...">
          Sign In
        </Button>
      </div>
    )
    const loadingButton = screen.getByRole('button', { name: /signing in/i })
    expect(loadingButton).toHaveAttribute('aria-busy', 'true')
    expect(loadingButton).toBeDisabled()
    expect(loadingButton).toHaveTextContent('Signing in...')

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    rerender(
      <div className="grid w-full">
        <Button loading={false} loadingText="Signing in...">
          Sign In
        </Button>
      </div>
    )
    const idleButton = screen.getByRole('button', { name: /sign in/i })
    expect(idleButton).toHaveAttribute('aria-busy', 'false')
    expect(idleButton).not.toBeDisabled()
    expect(idleButton).toHaveTextContent('Sign In')
  })

  it('transitions tooltip-wrapped Button loading state cleanly when browser translation wraps text nodes', () => {
    const { rerender } = render(
      <Button
        loading={false}
        loadingText="Sending reset link..."
        tooltip="Send a password reset link"
      >
        Send Reset Link
      </Button>
    )

    const button = screen.getByRole('button', { name: /send reset link/i })
    expect(simulateBrowserTranslation(button)).toBeGreaterThan(0)

    rerender(
      <Button
        loading={true}
        loadingText="Sending reset link..."
        tooltip="Send a password reset link"
      >
        Send Reset Link
      </Button>
    )
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Sending reset link...')

    expect(simulateBrowserTranslation(button)).toBeGreaterThan(0)

    rerender(
      <Button
        loading={false}
        loadingText="Sending reset link..."
        tooltip="Send a password reset link"
      >
        Send Reset Link
      </Button>
    )
    expect(button).toHaveAttribute('aria-busy', 'false')
    expect(button).not.toBeDisabled()
    expect(button).toHaveTextContent('Send Reset Link')
  })

  it('preserves mixed icon and label children inside Button across translated loading transitions', () => {
    const { rerender } = render(
      <Button
        loading={false}
        loadingText="Retrying..."
        tooltip="Retry action"
        className="gap-2"
      >
        <span data-testid="synthetic-icon" aria-hidden="true" />
        Retry
      </Button>
    )

    const button = screen.getByRole('button', { name: /retry/i })
    expect(screen.getByTestId('synthetic-icon')).toBeInTheDocument()
    expect(simulateBrowserTranslation(button)).toBeGreaterThan(0)

    rerender(
      <Button
        loading={true}
        loadingText="Retrying..."
        tooltip="Retry action"
        className="gap-2"
      >
        <span data-testid="synthetic-icon" aria-hidden="true" />
        Retry
      </Button>
    )
    expect(button).toHaveTextContent('Retrying...')

    expect(simulateBrowserTranslation(button)).toBeGreaterThan(0)

    rerender(
      <Button
        loading={false}
        loadingText="Retrying..."
        tooltip="Retry action"
        className="gap-2"
      >
        <span data-testid="synthetic-icon" aria-hidden="true" />
        Retry
      </Button>
    )
    expect(screen.getByTestId('synthetic-icon')).toBeInTheDocument()
    expect(button).toHaveTextContent('Retry')
  })

  it('submits LoginForm and toggles OAuth loading cleanly on a translated auth page', async () => {
    let resolveLoginResponse!: (value: unknown) => void
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoginResponse = resolve
        })
    )

    const { container } = render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'person@example.test' }
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'SyntheticPass!234' }
    })

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled()
    })

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    await act(async () => {
      resolveLoginResponse({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid login credentials' }
        })
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invalid email or password'
      )
    })

    let resolveOAuth!: (value: { error: { message: string } }) => void
    mockSignInWithOAuth.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOAuth = resolve
        })
    )

    expect(simulateBrowserTranslation(container)).toBeGreaterThan(0)

    fireEvent.click(
      screen.getByRole('button', { name: /continue with google/i })
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /continue with google/i })
      ).toBeDisabled()
    })

    await act(async () => {
      resolveOAuth({ error: { message: 'Synthetic provider error' } })
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /continue with google/i })
      ).not.toBeDisabled()
    })
  })
})
