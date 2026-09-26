import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RaidConfigPanel } from './RaidConfigPanel'

const config = (scope: string, version: string) => ({
  id: `${scope}-${version}`,
  scope,
  game_version: version,
  first_pass_sequence: ['L1', 'L2', 'M1'],
  loop_sequence: ['L1', 'L2', 'M1'],
  loop_start_stage: 'L1',
  is_active: true,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('RaidConfigPanel', () => {
  it('renders guild overrides and defensively hides legacy global rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          configs: [config('global', 'retired'), config('TEST', '1.41')]
        })
      }))
    )

    render(<RaidConfigPanel />)

    await waitFor(() => {
      expect(screen.getByText(/1\.41.*TEST/)).toBeTruthy()
    })
    expect(screen.queryByText(/retired.*global/)).toBeNull()
    expect(
      screen.getByRole('heading', {
        name: 'Guild Raid Progression Overrides'
      })
    ).toBeTruthy()
    expect(screen.queryByText('Global Configs')).toBeNull()
  })

  it('shows an explicit empty state when no guild override exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ configs: [] })
      }))
    )

    render(<RaidConfigPanel />)

    expect(
      await screen.findByText('No guild-specific overrides configured.')
    ).toBeTruthy()
  })
})
