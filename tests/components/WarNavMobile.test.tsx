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

describe('WarNav mobile reachability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('global mode mobile dropdown', () => {
    it('renders active label for Maps in mobile trigger', () => {
      setNavigationContext('/wars/maps', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const trigger = screen.getByTestId('dropdown-trigger')
      expect(trigger.textContent).toContain('Maps')
      expect(within(trigger).getByRole('button')).toHaveClass('min-h-11')
      const content = screen.getByTestId('dropdown-content')
      const mapsLink = within(content).getByRole('link', { name: /Maps/ })
      expect(mapsLink).toHaveAttribute('aria-current', 'page')
      expect(mapsLink).toHaveClass('min-h-11')
    })

    it('renders active label for War Reports in mobile trigger', () => {
      setNavigationContext('/wars', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const trigger = screen.getByTestId('dropdown-trigger')
      expect(trigger.textContent).toContain('War Reports')
    })

    it('renders all 8 global links in mobile dropdown', () => {
      setNavigationContext('/wars', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const content = screen.getByTestId('dropdown-content')
      const links = within(content).getAllByRole('link')
      expect(links.length).toBe(8)
    })

    it('preserves season in mobile dropdown links', () => {
      setNavigationContext('/wars', '5')
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const content = screen.getByTestId('dropdown-content')
      const links = within(content).getAllByRole('link')
      for (const link of links) {
        expect(link.getAttribute('href')).toContain('season=5')
      }
    })
  })

  describe('detail mode mobile dropdown', () => {
    it('renders active label for Guild tab in mobile trigger', () => {
      setNavigationContext('/wars/abc-123/guild', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const trigger = screen.getByTestId('dropdown-trigger')
      expect(trigger.textContent).toContain('Guild')
    })

    it('renders all 7 detail tabs in mobile dropdown', () => {
      setNavigationContext('/wars/abc-123', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const content = screen.getByTestId('dropdown-content')
      const links = within(content).getAllByRole('link')
      expect(links.length).toBe(7)
    })

    it('includes warId in mobile dropdown detail links', () => {
      setNavigationContext('/wars/abc-123', null)
      render(<WarSubnav mode={{ kind: 'detail', warId: 'abc-123' }} />)

      const content = screen.getByTestId('dropdown-content')
      const guildLink = within(content).getByRole('link', { name: /Guild/ })
      expect(guildLink.getAttribute('href')).toBe('/wars/abc-123/guild')
    })
  })

  describe('mobile dropdown shows all primary destinations', () => {
    it('includes the consolidated war sections in the global dropdown', () => {
      setNavigationContext('/wars', null)
      render(<WarSubnav mode={{ kind: 'global' }} />)

      const content = screen.getByTestId('dropdown-content')
      for (const label of [
        'War Reports',
        'Guild Metrics',
        'Lineups',
        'Maps',
        'Cores',
        'Team Analysis',
        'Config'
      ]) {
        expect(
          within(content).getByRole('link', { name: new RegExp(label) })
        ).toBeInTheDocument()
      }
    })
  })
})
