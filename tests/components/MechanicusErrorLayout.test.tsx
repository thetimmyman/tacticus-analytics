import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MechanicusErrorLayout } from '@/app/components/error/MechanicusErrorLayout'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}))

describe('MechanicusErrorLayout', () => {
  it('renders core error content with defaults', () => {
    render(
      <MechanicusErrorLayout
        protocol="ALPHA-7"
        errorCode="500"
        title="SYSTEM FAILURE"
        message="Something went wrong."
      />
    )

    expect(screen.getByText('ALPHA-7')).toBeInTheDocument()
    expect(screen.getByText(/ERROR CODE: 500/)).toBeInTheDocument()
    expect(screen.getByText('SYSTEM FAILURE')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(
      screen.getByText(/machine spirit communication/i)
    ).toBeInTheDocument()
    const homeLink = screen.getByRole('link', { name: /return to forge/i })
    expect(homeLink).toHaveAttribute('href', '/')
  })

  it('renders retry and login actions when enabled', () => {
    const onRetry = vi.fn()
    render(
      <MechanicusErrorLayout
        protocol="BETA-9"
        errorCode="401"
        title="ACCESS DENIED"
        message="Auth required."
        showRetryButton
        showHomeButton={false}
        showLoginButton
        onRetry={onRetry}
      >
        <div>Custom child</div>
      </MechanicusErrorLayout>
    )

    expect(screen.getByText('Custom child')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry operation/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /authenticate/i })).toHaveAttribute(
      'href',
      '/auth/login'
    )
    expect(screen.queryByRole('link', { name: /return to forge/i })).toBeNull()
  })

  it('renders technical details when provided', () => {
    render(
      <MechanicusErrorLayout
        protocol="DELTA-3"
        errorCode="404"
        title="NOT FOUND"
        message="Missing data."
        technicalDetails="Stack trace: missing row"
      />
    )

    expect(screen.getByText('Stack trace: missing row')).toBeInTheDocument()
  })
})
