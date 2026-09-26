import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const useWarZonesMock = vi.fn()

vi.mock('@/app/(dashboard)/wars/_hooks', () => ({
  useWarZones: (warId: string) => useWarZonesMock(warId)
}))

vi.mock('@/app/(dashboard)/wars/_components/ZoneStatsGrid', () => ({
  default: ({ zones }: { zones: unknown[] }) => (
    <div data-testid="zone-stats-grid">zones:{zones.length}</div>
  )
}))

const { default: ZoneStatsSection } =
  await import('@/app/(dashboard)/wars/[warId]/board/ZoneStatsSection')

afterEach(() => {
  useWarZonesMock.mockReset()
})

describe('ZoneStatsSection render-equivalence', () => {
  it('renders the error Card (title + red copy) on error', () => {
    useWarZonesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('x')
    })
    const { container, getByText } = render(<ZoneStatsSection warId="w1" />)

    expect(getByText('Zone Stats Grid')).toBeTruthy()
    const errorCopy = getByText(
      'Failed to load zone data. Please try refreshing the page.'
    )
    expect(errorCopy.className).toContain('text-red-400')
    expect(container.querySelector('.space-y-4')).toBeNull()
    expect(
      container.querySelector('[data-testid="zone-stats-grid"]')
    ).toBeNull()
  })

  it('renders the 6-tile grid skeleton when loading', () => {
    useWarZonesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null
    })
    const { container } = render(<ZoneStatsSection warId="w1" />)

    const tiles = container.querySelectorAll('.grid > div')
    expect(tiles.length).toBe(6)
    expect(
      container.querySelector('[data-testid="zone-stats-grid"]')
    ).toBeNull()
  })

  it('renders the data state with ZoneStatsGrid when zones are present', () => {
    useWarZonesMock.mockReturnValue({
      data: [{ id: 'z1' }, { id: 'z2' }],
      isLoading: false,
      error: null
    })
    const { container, getByTestId, getByText } = render(
      <ZoneStatsSection warId="w1" />
    )

    expect(container.querySelector('.space-y-4')).not.toBeNull()
    expect(getByText('Zone Stats Grid')).toBeTruthy()
    expect(getByTestId('zone-stats-grid').textContent).toBe('zones:2')
  })

  it('renders the empty-state copy when data is an empty array', () => {
    useWarZonesMock.mockReturnValue({ data: [], isLoading: false, error: null })
    const { getByText, container } = render(<ZoneStatsSection warId="w1" />)

    expect(getByText('No zone data available for this war')).toBeTruthy()
    expect(
      container.querySelector('[data-testid="zone-stats-grid"]')
    ).toBeNull()
  })
})
