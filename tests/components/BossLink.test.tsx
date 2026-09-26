import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BossLink } from '@/app/components/ui/BossLink'

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

vi.mock('@/app/components/ui/BossPortrait', () => ({
  BossPortrait: ({ bossName }: { bossName: string }) => (
    <span data-testid="boss-portrait">{bossName}</span>
  )
}))

describe('BossLink', () => {
  beforeEach(() => {
    mockUsePathname.mockReset()
  })

  it('renders content without link when already on boss page', () => {
    mockUsePathname.mockReturnValue('/boss')

    render(<BossLink bossName="Hive Tyrant" showPortrait />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('boss-portrait')).toHaveTextContent('Hive Tyrant')
    expect(screen.getAllByText('Hive Tyrant')).toHaveLength(2)
  })

  it('renders link when not on boss page', () => {
    mockUsePathname.mockReturnValue('/dashboard')

    render(
      <BossLink bossName="Hive Tyrant" className="extra">
        Boss Label
      </BossLink>
    )

    const link = screen.getByRole('link', { name: 'Boss Label' })
    expect(link).toHaveAttribute('href', '/boss?boss=Hive%20Tyrant')
    expect(link).toHaveAttribute('title', 'View stats for Hive Tyrant')
    expect(link).toHaveClass('extra')
    expect(screen.queryByTestId('boss-portrait')).toBeNull()
  })
})
