import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'

const mockUsePathname = vi.fn()

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    title
  }: {
    children: React.ReactNode
    href: string
    className?: string
    title?: string
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  )
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname()
}))

describe('PlayerLink', () => {
  beforeEach(() => {
    mockUsePathname.mockReset()
  })

  it('renders a span when already on player stats', () => {
    mockUsePathname.mockReturnValue('/player-stats')

    render(<PlayerLink playerName="Alpha" />)

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a link to player stats search', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    render(
      <PlayerLink playerName="Hive Tyrant" className="extra">
        Custom Label
      </PlayerLink>
    )

    const link = screen.getByRole('link', { name: 'Custom Label' })
    expect(link).toHaveAttribute('href', '/player-stats?search=Hive%20Tyrant')
    expect(link).toHaveAttribute('title', 'View stats for Hive Tyrant')
    expect(link).toHaveClass('extra')
  })
})
