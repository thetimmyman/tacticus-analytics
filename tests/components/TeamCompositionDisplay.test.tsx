import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'

const HERO_FIXTURES: Record<string, { displayName: string; iconUrl: string }> =
  {
    hero_marneus: {
      displayName: 'Marneus Calgar',
      iconUrl: 'https://example.com/marneus.png'
    },
    hero_ragnar: {
      displayName: 'Ragnar Blackmane',
      iconUrl: 'https://example.com/ragnar.png'
    },
    hero_alpha_id: {
      displayName: 'Zed Hero',
      iconUrl: 'https://example.com/zed.png'
    },
    hero_zed_id: {
      displayName: 'Alpha Hero',
      iconUrl: 'https://example.com/alpha.png'
    },
    mow_stormbird: {
      displayName: 'Stormbird',
      iconUrl: 'https://example.com/stormbird.png'
    }
  }

const mockHeroCatalog = {
  getById: vi.fn((id: string) => HERO_FIXTURES[id] || null),
  getByName: vi.fn((name: string) => {
    const normalized = name.toLowerCase()
    return (
      Object.values(HERO_FIXTURES).find(
        (hero) => hero.displayName.toLowerCase() === normalized
      ) || null
    )
  }),
  getByNativeId: vi.fn((id: string) => HERO_FIXTURES[id] || null)
}

vi.mock('@/app/lib/catalogs', () => ({
  useHeroCatalog: vi.fn(() => ({
    data: mockHeroCatalog,
    isLoading: false
  }))
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className}>
      Loading...
    </div>
  )
}))

describe('TeamCompositionDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty when no hero data provided', () => {
    const { container } = render(<TeamCompositionDisplay />)
    expect(
      container.querySelector('.flex.items-center.gap-1')
    ).toBeInTheDocument()
  })

  it('parses heroDetails JSON and displays heroes', () => {
    const heroDetails = JSON.stringify([
      { unitId: 'hero_marneus' },
      { unitId: 'hero_ragnar' }
    ])

    render(<TeamCompositionDisplay heroDetails={heroDetails} />)

    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByTitle('Marneus Calgar')).toBeInTheDocument()
    expect(screen.getByTitle('Ragnar Blackmane')).toBeInTheDocument()
  })

  it('sorts portrait order by resolved display name', () => {
    const heroDetails = JSON.stringify([
      { unitId: 'hero_alpha_id' },
      { unitId: 'hero_zed_id' }
    ])

    render(<TeamCompositionDisplay heroDetails={heroDetails} />)

    expect(
      screen.getAllByRole('img').map((img) => img.getAttribute('title'))
    ).toEqual(['Alpha Hero', 'Zed Hero'])
  })

  it('parses machineOfWarDetails and displays MOW', () => {
    const heroDetails = JSON.stringify([{ unitId: 'hero_marneus' }])
    const machineOfWarDetails = JSON.stringify({ unitId: 'mow_stormbird' })

    render(
      <TeamCompositionDisplay
        heroDetails={heroDetails}
        machineOfWarDetails={machineOfWarDetails}
      />
    )

    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByTitle('Marneus Calgar')).toBeInTheDocument()
    expect(screen.getByTitle('Stormbird')).toBeInTheDocument()
    expect(screen.getByText('&')).toBeInTheDocument()
  })

  it('shows placeholder for unknown heroes', () => {
    const heroDetails = JSON.stringify([{ unitId: 'unknown_hero' }])

    render(<TeamCompositionDisplay heroDetails={heroDetails} />)

    expect(screen.getByTitle('unknown_hero')).toBeInTheDocument()
    expect(screen.getByText('UN')).toBeInTheDocument()
  })

  it('uses custom icon size', () => {
    const heroDetails = JSON.stringify([{ unitId: 'hero_marneus' }])

    render(<TeamCompositionDisplay heroDetails={heroDetails} iconSize={32} />)

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('width', '32')
    expect(img).toHaveAttribute('height', '32')
  })

  it('displays text names when showNames is true', () => {
    const heroDetails = JSON.stringify([
      { unitId: 'hero_marneus' },
      { unitId: 'hero_ragnar' }
    ])

    render(
      <TeamCompositionDisplay heroDetails={heroDetails} showNames={true} />
    )

    expect(screen.getByText(/hero_marneus hero_ragnar/)).toBeInTheDocument()
  })

  it('displays text names with MOW when showNames is true', () => {
    const heroDetails = JSON.stringify([{ unitId: 'hero_marneus' }])
    const machineOfWarDetails = JSON.stringify({ unitId: 'mow_stormbird' })

    render(
      <TeamCompositionDisplay
        heroDetails={heroDetails}
        machineOfWarDetails={machineOfWarDetails}
        showNames={true}
      />
    )

    expect(screen.getByText(/& mow_stormbird/)).toBeInTheDocument()
  })

  it('renders multiple structured hero details', () => {
    render(
      <TeamCompositionDisplay
        heroDetails={JSON.stringify([
          { unitId: 'hero_marneus' },
          { unitId: 'hero_ragnar' }
        ])}
      />
    )

    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it('renders structured hero and machine details together', () => {
    render(
      <TeamCompositionDisplay
        heroDetails={JSON.stringify([{ unitId: 'hero_marneus' }])}
        machineOfWarDetails={JSON.stringify({ unitId: 'mow_stormbird' })}
      />
    )

    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(screen.getByText('&')).toBeInTheDocument()
  })

  it('handles malformed heroDetails JSON gracefully', () => {
    render(<TeamCompositionDisplay heroDetails="not valid json" />)

    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('handles empty array in heroDetails', () => {
    render(<TeamCompositionDisplay heroDetails="[]" />)

    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('applies custom className', () => {
    const { container } = render(
      <TeamCompositionDisplay className="custom-class" />
    )

    expect(container.querySelector('.custom-class')).toBeInTheDocument()
  })

  it('shows loading skeleton when catalog is loading', async () => {
    const { useHeroCatalog } = await import('@/app/lib/catalogs')
    vi.mocked(useHeroCatalog).mockReturnValue({
      data: null,
      isLoading: true,
      error: null
    } as any)

    render(<TeamCompositionDisplay heroDetails='[{"unitId":"hero_marneus"}]' />)

    expect(screen.getAllByTestId('skeleton')).toHaveLength(3)
  })
})
