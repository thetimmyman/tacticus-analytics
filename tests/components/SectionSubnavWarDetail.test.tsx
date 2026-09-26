import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SectionSubnav } from '@/app/components/navigation/SectionSubnav'

const navigation = vi.hoisted(() => ({
  pathname: '/wars',
  season: null as string | null
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => ({
    get: (key: string) => (key === 'season' ? navigation.season : null)
  })
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode
    href: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}))

describe('SectionSubnav war-detail collapse', () => {
  beforeEach(() => {
    navigation.pathname = '/wars'
    navigation.season = null
  })

  it('collapses the global War rail to a single "All War Tools" exit chip on a war detail route, preserving ?season=', () => {
    navigation.pathname = '/wars/war-123/guild'
    navigation.season = '83'
    render(<SectionSubnav effectiveRole="member" />)

    const nav = screen.getByRole('navigation', { name: 'War workspace' })
    expect(nav).toHaveAttribute('data-subnav-emphasis', 'secondary')

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/wars?season=83')
    expect(links[0]).toHaveTextContent('All War Tools')

    expect(
      screen.queryByRole('link', { name: /War Reports/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Guild Metrics/ })
    ).not.toBeInTheDocument()
  })

  it('retains the full seven-pill global War rail on a global War route', () => {
    navigation.pathname = '/wars/maps'
    render(<SectionSubnav effectiveRole="member" />)

    const nav = screen.getByRole('navigation', { name: 'War sections' })
    expect(nav).toHaveAttribute('data-subnav-emphasis', 'primary')

    expect(screen.getByRole('link', { name: 'Maps' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'War Reports' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Guild Metrics' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Lineups' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Cores' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Team Analysis' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Config' })).toBeVisible()

    expect(
      screen.queryByRole('link', { name: /All War Tools/ })
    ).not.toBeInTheDocument()
  })

  it.each([
    '/wars',
    '/wars/lineups/offense',
    '/wars/cores/defense',
    '/wars/analyze/team',
    '/wars/config'
  ])('keeps the primary rail on global route %s', (pathname) => {
    navigation.pathname = pathname
    render(<SectionSubnav effectiveRole="member" />)

    const nav = screen.getByRole('navigation', { name: 'War sections' })
    expect(nav).toHaveAttribute('data-subnav-emphasis', 'primary')
    expect(
      screen.queryByRole('link', { name: /All War Tools/ })
    ).not.toBeInTheDocument()
  })

  it('leaves a non-War workspace unaffected while previewing on a war-detail pathname', () => {
    navigation.pathname = '/wars/war-123/guild'
    render(<SectionSubnav workspaceId="raid" effectiveRole="member" />)

    const nav = screen.getByRole('navigation', { name: 'Raid sections' })
    expect(nav).toHaveAttribute('data-subnav-emphasis', 'primary')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    expect(
      screen.queryByRole('link', { name: /All War Tools/ })
    ).not.toBeInTheDocument()
  })
})
