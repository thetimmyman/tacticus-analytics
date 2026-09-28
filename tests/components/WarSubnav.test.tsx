import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WarSubnav } from '@/app/components/navigation/WarSubnav'

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

vi.mock('@tacticus/ui-kit/radix-dropdown', () => ({
  RadixDropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  RadixDropdownMenuTrigger: ({
    children
  }: {
    children: React.ReactNode
    asChild?: boolean
  }) => <div data-testid="dropdown-trigger">{children}</div>,
  RadixDropdownMenuContent: ({
    children
  }: {
    children: React.ReactNode
    align?: string
    className?: string
  }) => <div data-testid="dropdown-content">{children}</div>
}))

function setNavigationContext(pathname: string, season: string | null) {
  mockUsePathname.mockReturnValue(pathname)
  mockUseSearchParams.mockReturnValue({
    get: (key: string) => (key === 'season' ? season : null)
  })
}

describe('WarSubnav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('global mode', () => {
    it('renders all global links with season preserved', () => {
      setNavigationContext('/wars', '5')
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const links = within(desktopNav).getAllByRole('link')

      expect(links.length).toBe(8)
      expect(links.map((l) => l.getAttribute('href'))).toContain(
        '/war-room?season=5'
      )

      for (const link of links) {
        expect(link.getAttribute('href')).toContain('season=5')
      }
    })

    it('highlights War Reports on exact /wars path', () => {
      setNavigationContext('/wars', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const warReportsLink = within(desktopNav).getByRole('link', {
        name: /War Reports/
      })
      expect(warReportsLink.className).toContain('text-[var(--accent)]')
      expect(warReportsLink).toHaveClass('min-h-11')
      expect(warReportsLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights Maps on /wars/maps path', () => {
      setNavigationContext('/wars/maps', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const mapsLink = within(desktopNav).getByRole('link', { name: /Maps/ })
      expect(mapsLink.className).toContain('text-[var(--accent)]')
      expect(mapsLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights Team Analysis on /wars/analyze/team path', () => {
      setNavigationContext('/wars/analyze/team', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const teamLink = within(desktopNav).getByRole('link', {
        name: /Team Analysis/
      })
      expect(teamLink.className).toContain('text-[var(--accent)]')
      expect(teamLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights Lineups on /wars/lineups/defense path (activePrefix)', () => {
      setNavigationContext('/wars/lineups/defense', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const lineupsLink = within(desktopNav).getByRole('link', {
        name: /Lineups/
      })
      expect(lineupsLink.className).toContain('text-[var(--accent)]')
      expect(lineupsLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights Cores on /wars/cores/defense path (activePrefix)', () => {
      setNavigationContext('/wars/cores/defense', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const coresLink = within(desktopNav).getByRole('link', { name: /Cores/ })
      expect(coresLink.className).toContain('text-[var(--accent)]')
      expect(coresLink).toHaveAttribute('aria-current', 'page')
    })
  })

  describe('detail mode', () => {
    it('renders 7 detail tabs with warId in hrefs', () => {
      setNavigationContext('/wars/abc-123', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const links = within(desktopNav).getAllByRole('link')

      expect(links.length).toBe(7)
      expect(
        within(desktopNav).getByRole('link', { name: /Overview/ })
      ).toHaveAttribute('href', '/wars/abc-123')
      expect(
        within(desktopNav).getByRole('link', { name: /Guild/ })
      ).toHaveAttribute('href', '/wars/abc-123/guild')
      expect(
        within(desktopNav).getByRole('link', { name: /Opponent/ })
      ).toHaveAttribute('href', '/wars/abc-123/opponent')
      expect(
        within(desktopNav).getByRole('link', { name: /War Board/ })
      ).toHaveAttribute('href', '/wars/abc-123/board')
    })

    it('highlights Overview on exact /wars/{warId} path', () => {
      setNavigationContext('/wars/abc-123', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const overviewLink = within(desktopNav).getByRole('link', {
        name: /Overview/
      })
      expect(overviewLink.className).toContain('text-[var(--accent)]')
      expect(overviewLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights Guild on /wars/{warId}/guild path', () => {
      setNavigationContext('/wars/abc-123/guild', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const guildLink = within(desktopNav).getByRole('link', { name: /Guild/ })
      expect(guildLink.className).toContain('text-[var(--accent)]')
      expect(guildLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights War Board on /wars/{warId}/board path', () => {
      // /zones and /maps redirect here.
      setNavigationContext('/wars/abc-123/board', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const boardLink = within(desktopNav).getByRole('link', {
        name: /War Board/
      })
      expect(boardLink.className).toContain('text-[var(--accent)]')
      expect(boardLink).toHaveAttribute('aria-current', 'page')
    })

    it('preserves season in detail tab links', () => {
      setNavigationContext('/wars/abc-123', '5')
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const guildLink = within(desktopNav).getByRole('link', { name: /Guild/ })
      expect(guildLink.getAttribute('href')).toBe(
        '/wars/abc-123/guild?season=5'
      )
    })
  })

  describe('breadcrumbs', () => {
    it('renders no wars-specific breadcrumb trail (removed per operator feedback)', () => {
      setNavigationContext('/wars/maps', '5')
      render(<WarSubnav mode={{ kind: 'global' }} />)

      expect(
        screen.queryByLabelText('Wars breadcrumbs')
      ).not.toBeInTheDocument()
    })
  })

  describe('season context', () => {
    it('does not append season when absent', () => {
      setNavigationContext('/wars', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const desktopNav = screen.getByLabelText('Wars navigation')
      const links = within(desktopNav).getAllByRole('link')
      for (const link of links) {
        expect(link.getAttribute('href')).not.toContain('season')
      }
    })
  })

  describe('mobile compact dropdown', () => {
    it('renders dropdown with active link label', () => {
      setNavigationContext('/wars/maps', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const trigger = screen.getByTestId('dropdown-trigger')
      expect(trigger.textContent).toContain('Maps')
    })

    it('renders all links in dropdown content', () => {
      setNavigationContext('/wars', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const content = screen.getByTestId('dropdown-content')
      const links = within(content).getAllByRole('link')
      expect(links.length).toBe(8)
    })
  })
})
