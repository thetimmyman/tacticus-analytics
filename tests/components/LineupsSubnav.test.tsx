import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LineupsSubnav } from '@/app/(dashboard)/wars/lineups/_components/LineupsSubnav'

const mockUsePathname = vi.fn()
const mockUseSearchParams = vi.fn()

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams()
}))

function setNavigationContext(pathname: string, season: string | null) {
  mockUsePathname.mockReturnValue(pathname)
  mockUseSearchParams.mockReturnValue({
    get: (key: string) => (key === 'season' ? season : null)
  })
}

describe('LineupsSubnav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the three lineup sections', () => {
    setNavigationContext('/wars/lineups/offense', null)
    render(<LineupsSubnav />)

    const nav = screen.getByLabelText('Lineups sections')
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Compositions',
      'Offense Heroes',
      'Defense Heroes'
    ])
  })

  it('marks the active section with the accent pill treatment', () => {
    setNavigationContext('/wars/lineups/attackers', null)
    render(<LineupsSubnav />)

    const nav = screen.getByLabelText('Lineups sections')
    const active = within(nav).getByRole('link', { name: 'Offense Heroes' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(active.className).toContain('text-(--accent)')
    expect(active.className).toContain('rounded-full')

    const inactive = within(nav).getByRole('link', { name: 'Compositions' })
    expect(inactive).not.toHaveAttribute('aria-current')
    expect(inactive.className).not.toContain('text-(--accent)')
  })

  it('renders the side toggle inline while Compositions is active', () => {
    setNavigationContext('/wars/lineups/defense', null)
    render(<LineupsSubnav />)

    const toggle = screen.getByRole('group', { name: 'Composition side' })
    expect(within(toggle).getByText('Defense')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(toggle).getByRole('link', { name: 'Offense' })
    ).toHaveAttribute('href', '/wars/lineups/offense')
  })

  it('hides the side toggle on the per-hero tables', () => {
    setNavigationContext('/wars/lineups/defenders', null)
    render(<LineupsSubnav />)

    expect(
      screen.queryByRole('group', { name: 'Composition side' })
    ).not.toBeInTheDocument()
  })

  it('preserves the season across rail links and the side toggle', () => {
    setNavigationContext('/wars/lineups/offense', '5')
    render(<LineupsSubnav />)

    const nav = screen.getByLabelText('Lineups sections')
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.getAttribute('href')).toContain('season=5')
    }

    const toggle = screen.getByRole('group', { name: 'Composition side' })
    expect(
      within(toggle).getByRole('link', { name: 'Defense' }).getAttribute('href')
    ).toBe('/wars/lineups/defense?season=5')
  })

  it('keeps one horizontally scrollable rail with touch-safe controls', () => {
    setNavigationContext('/wars/lineups/offense', null)
    render(<LineupsSubnav />)

    expect(screen.getByTestId('lineups-subnav-row').className).toContain(
      'overflow-x-auto'
    )

    const nav = screen.getByLabelText('Lineups sections')
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }

    const toggle = screen.getByRole('group', { name: 'Composition side' })
    expect(within(toggle).getByText('Offense').className).toContain('min-h-11')
    expect(
      within(toggle).getByRole('link', { name: 'Defense' }).className
    ).toContain('min-h-11')
  })
})
