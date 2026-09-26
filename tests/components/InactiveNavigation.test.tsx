import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceBar } from '@/app/components/navigation/WorkspaceBar'
import { SectionSubnav } from '@/app/components/navigation/SectionSubnav'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode
    href: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('@/app/lib/utils/release-stage', () => ({
  canAccessReleaseStage: () => true
}))

const inactiveProps = {
  effectiveRole: 'member' as const,
  hideAnalytics: true,
  hasProfile: false,
  hasCluster: false
}

describe('inactive navigation allowlist', () => {
  it('limits the desktop workspace bar to safe public workspaces', () => {
    render(<WorkspaceBar {...inactiveProps} />)

    expect(screen.getByRole('link', { name: 'Command' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(screen.getByRole('link', { name: 'Community' })).toHaveAttribute(
      'href',
      '/creators'
    )
    expect(screen.queryByRole('link', { name: 'Raid' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Guild Ops' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'War' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Tools' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Settings' })
    ).not.toBeInTheDocument()
  })

  it('limits the desktop section row to inactive-safe routes', () => {
    render(<SectionSubnav {...inactiveProps} />)

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/explore'
    )
    expect(
      screen.queryByRole('link', { name: 'Roster' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Achievements' })
    ).not.toBeInTheDocument()
  })
})
