import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WinterThemeToggle } from '@/app/components/seasonal/WinterThemeToggle'
import { useWinterTheme } from '@/app/components/seasonal/WinterThemeProvider'

vi.mock('@/app/components/seasonal/WinterThemeProvider', () => ({
  useWinterTheme: vi.fn()
}))

const buildBaseState = () => ({
  isWinterThemeActive: false,
  toggleWinterTheme: vi.fn(),
  snowIntensity: 'light' as const,
  setSnowIntensity: vi.fn(),
  showLights: false,
  setShowLights: vi.fn(),
  showElves: false,
  setShowElves: vi.fn()
})

const buildThemeState = (
  overrides: Partial<ReturnType<typeof buildBaseState>> = {}
) => ({
  ...buildBaseState(),
  ...overrides
})

const mockUseWinterTheme = vi.mocked(useWinterTheme)

describe('WinterThemeToggle', () => {
  beforeEach(() => {
    mockUseWinterTheme.mockReset()
  })

  it('renders icon variant and toggles theme', () => {
    const state = buildThemeState()
    mockUseWinterTheme.mockReturnValue(state)

    render(<WinterThemeToggle variant="icon" />)

    const button = screen.getByTitle(/enable winter theme/i)
    fireEvent.click(button)

    expect(state.toggleWinterTheme).toHaveBeenCalledTimes(1)
  })

  it('renders compact variant with active state', () => {
    const state = buildThemeState({ isWinterThemeActive: true })
    mockUseWinterTheme.mockReturnValue(state)

    render(<WinterThemeToggle variant="compact" />)

    expect(screen.getByText('Winter Mode On')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /winter mode on/i }))
    expect(state.toggleWinterTheme).toHaveBeenCalledTimes(1)
  })

  it('renders full variant with inactive hint', () => {
    const state = buildThemeState()
    mockUseWinterTheme.mockReturnValue(state)

    render(<WinterThemeToggle />)

    expect(screen.getByText(/winter wonderland theme/i)).toBeInTheDocument()
    expect(
      screen.getByText(/enable to see snow, lights, decorations/i)
    ).toBeInTheDocument()
  })

  it('shows customization controls when expanded', () => {
    const state = buildThemeState({ isWinterThemeActive: true })
    mockUseWinterTheme.mockReturnValue(state)

    render(<WinterThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: /customize effects/i }))

    expect(screen.getByText('Snow Intensity')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /medium/i }))
    expect(state.setSnowIntensity).toHaveBeenCalledWith('medium')
  })
})
