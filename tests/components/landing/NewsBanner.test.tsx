import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NewsBanner from '@/app/components/landing/NewsBanner'

let mockEmblaRef = vi.fn()
let mockAutoplay = { play: vi.fn(), stop: vi.fn() }
let mockEmblaApi = {
  scrollPrev: vi.fn(),
  scrollNext: vi.fn(),
  scrollTo: vi.fn(),
  plugins: vi.fn(() => ({ autoplay: mockAutoplay })),
  selectedScrollSnap: vi.fn(() => 0),
  on: vi.fn(),
  off: vi.fn()
}

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('embla-carousel-react', () => ({
  default: () => [mockEmblaRef, mockEmblaApi]
}))

vi.mock('embla-carousel-autoplay', () => ({
  default: vi.fn(() => ({}))
}))

vi.mock('lucide-react', () => ({
  Megaphone: () => <svg data-testid="megaphone-icon" />,
  Gift: () => <svg data-testid="gift-icon" />,
  Users: () => <svg data-testid="users-icon" />,
  Sparkles: () => <svg data-testid="sparkles-icon" />,
  ExternalLink: () => <svg data-testid="external-icon" />,
  ChevronLeft: () => <svg data-testid="chevron-left" />,
  ChevronRight: () => <svg data-testid="chevron-right" />,
  Pause: () => <svg data-testid="pause-icon" />,
  Play: () => <svg data-testid="play-icon" />,
  Snowflake: () => <svg data-testid="snowflake-icon" />
}))

vi.mock('@/app/components/seasonal', () => ({
  WinterCarouselEasterEgg: () => <div data-testid="winter-easter-egg" />
}))

describe('NewsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmblaRef = vi.fn()
    mockAutoplay = { play: vi.fn(), stop: vi.fn() }
    mockEmblaApi = {
      scrollPrev: vi.fn(),
      scrollNext: vi.fn(),
      scrollTo: vi.fn(),
      plugins: vi.fn(() => ({ autoplay: mockAutoplay })),
      selectedScrollSnap: vi.fn(() => 0),
      on: vi.fn(),
      off: vi.fn()
    }
  })

  it('returns null when there are no items', () => {
    const { container } = render(<NewsBanner items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders items with navigation controls', () => {
    render(
      <NewsBanner
        items={[
          {
            id: 'promo-1',
            type: 'promo',
            title: 'Promo Time',
            description: 'Get a reward.',
            href: 'https://example.com',
            external: true
          },
          {
            id: 'feature-1',
            type: 'feature',
            title: 'New Feature',
            description: 'Try it now.',
            href: '/feature'
          }
        ]}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'Promo Time' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'New Feature' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Previous slide')).toBeInTheDocument()
    expect(screen.getByLabelText('Next slide')).toBeInTheDocument()
    expect(screen.getByLabelText('Pause autoplay')).toBeInTheDocument()

    const externalLink = screen.getByRole('link', { name: /promo time/i })
    expect(externalLink).toHaveAttribute('href', 'https://example.com')
    expect(externalLink).toHaveAttribute('target', '_blank')

    const internalLink = screen.getByRole('link', { name: /new feature/i })
    expect(internalLink).toHaveAttribute('href', '/feature')
    expect(internalLink).not.toHaveAttribute('target')
  })

  it('toggles autoplay state on click', () => {
    render(
      <NewsBanner
        items={[
          {
            id: 'announcement-1',
            type: 'announcement',
            title: 'Announcement',
            description: 'Important update.'
          },
          {
            id: 'announcement-2',
            type: 'announcement',
            title: 'Another Update',
            description: 'More news.'
          }
        ]}
      />
    )

    const toggleButton = screen.getByLabelText('Pause autoplay')
    fireEvent.click(toggleButton)

    expect(screen.getByLabelText('Resume autoplay')).toBeInTheDocument()
  })
})
