import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import MetaTeamTable from './MetaTeamTable'
import type { MetaTeam } from './types'

const team: MetaTeam = {
  id: '10000000-0000-4000-8000-000000000001',
  guild_code: 'OTHER',
  name: 'Ork swarm',
  side: 'offense',
  priority: 1,
  notes: null,
  heroes: [{ unitId: 'alpha', role: 'core' }],
  created_at: '2026-09-25T00:00:00.000Z',
  updated_at: '2026-09-25T00:00:00.000Z'
}

function renderTable(readinessAvailable: boolean) {
  return render(
    <MetaTeamTable
      teams={[team]}
      readinessById={new Map()}
      usedByUnit={new Map()}
      catalog={undefined}
      canEdit={false}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      getHeroById={() => undefined}
      readinessAvailable={readinessAvailable}
      rosterStatus="ready"
      minRankIndex={null}
    />
  )
}

describe('MetaTeamTable readiness availability', () => {
  it('does not present uncomputed readiness as ready', () => {
    renderTable(false)

    const table = screen.getByRole('table')
    expect(within(table).getByText('Ork swarm')).toBeTruthy()
    expect(within(table).queryByText('Readiness')).toBeNull()
    expect(within(table).queryByText('Gear floor')).toBeNull()
    expect(within(table).queryByText('ready')).toBeNull()
  })

  it('shows readiness columns for the caller own guild', () => {
    renderTable(true)

    const table = screen.getByRole('table')
    expect(within(table).getByText('Readiness')).toBeTruthy()
    expect(within(table).getByText('Gear floor')).toBeTruthy()
  })
})
