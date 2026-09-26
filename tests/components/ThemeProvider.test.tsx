import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { ThemeProvider, useTheme } from '@/app/components/ThemeProvider'

const dbMocks = vi.hoisted(() => {
  const secondEq = vi.fn(() => Promise.resolve({ error: null }))
  const firstEq = vi.fn(() => ({ eq: secondEq }))
  const update = vi.fn(() => ({ eq: firstEq }))
  const from = vi.fn(() => ({ update }))
  const dbClient = vi.fn(() => ({ from }))

  return {
    dbClient,
    firstEq,
    from,
    secondEq,
    update
  }
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: dbMocks.dbClient
}))

const profile = {
  user_id: 'user-1',
  guild_code: 'TEST',
  role: 'member',
  theme_preference: 'dark'
} as PlayerMapping

function ThemeProbe() {
  const { currentThemeCode, resetToGuildTheme, setTheme } = useTheme()

  return (
    <>
      <div data-testid="theme-code">{currentThemeCode}</div>
      <button onClick={() => void setTheme('light')}>Set light</button>
      <button onClick={() => void resetToGuildTheme()}>Reset guild</button>
    </>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('does not create the database client during initial theme render', async () => {
    render(
      <ThemeProvider profile={profile}>
        <ThemeProbe />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('theme-code')).toHaveTextContent('dark')
    })
    expect(dbMocks.dbClient).not.toHaveBeenCalled()
  })

  it('saves explicit theme preferences through the lazy database client', async () => {
    render(
      <ThemeProvider profile={profile}>
        <ThemeProbe />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /set light/i }))

    await waitFor(() => {
      expect(dbMocks.dbClient).toHaveBeenCalledTimes(1)
    })
    expect(dbMocks.from).toHaveBeenCalledWith('player_mapping')
    expect(dbMocks.update).toHaveBeenCalledWith({
      theme_preference: 'light'
    })
    expect(dbMocks.firstEq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(dbMocks.secondEq).toHaveBeenCalledWith('is_current', true)
  })

  it('resets to the guild theme through the lazy database client', async () => {
    render(
      <ThemeProvider profile={profile}>
        <ThemeProbe />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /reset guild/i }))

    await waitFor(() => {
      expect(dbMocks.dbClient).toHaveBeenCalledTimes(1)
    })
    expect(dbMocks.update).toHaveBeenCalledWith({
      theme_preference: 'guild'
    })
  })
})
