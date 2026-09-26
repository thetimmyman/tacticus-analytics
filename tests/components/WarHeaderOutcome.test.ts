import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WarHeader, {
  getWarOutcomeTone
} from '@/app/(dashboard)/wars/_components/WarHeader'
import type { WarInfo } from '@/app/(dashboard)/wars/_types'

function war(overrides: Partial<WarInfo> = {}): WarInfo {
  return {
    warId: 'war-123',
    warSlug: 'war-123',
    status: 'in_progress',
    startTime: '2026-08-01T00:00:00Z',
    guild: {
      guildCode: 'EOT',
      guildName: 'Example Alliance',
      guildTag: 'EOT',
      score: 120
    },
    opponent: {
      guildName: 'Opponent',
      guildTag: 'OPP',
      score: 100
    },
    ...overrides
  }
}

describe('getWarOutcomeTone', () => {
  it('prefers the recorded result over the live score delta', () => {
    expect(getWarOutcomeTone(war({ result: 'loss' }))).toBe('behind')
    expect(getWarOutcomeTone(war({ result: 'draw' }))).toBe('even')
  })

  it('falls back to the live score when no result is recorded', () => {
    expect(getWarOutcomeTone(war())).toBe('ahead')
    expect(
      getWarOutcomeTone(
        war({
          guild: { ...war().guild, score: 80 },
          opponent: { ...war().opponent, score: 100 }
        })
      )
    ).toBe('behind')
  })

  it('keeps scheduled and cancelled wars neutral without a recorded result', () => {
    expect(getWarOutcomeTone(war({ status: 'scheduled' }))).toBe('even')
    expect(getWarOutcomeTone(war({ status: 'cancelled' }))).toBe('even')
  })
})

describe('WarHeader outcome copy', () => {
  it('does not describe a cancelled war as leading or behind', () => {
    render(createElement(WarHeader, { war: war({ status: 'cancelled' }) }))

    expect(screen.getByText('No active outcome')).toBeInTheDocument()
    expect(screen.queryByText(/Leading by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Behind by/)).not.toBeInTheDocument()
  })

  it('uses an authoritative result instead of a contradictory score delta', () => {
    render(createElement(WarHeader, { war: war({ result: 'loss' }) }))

    expect(screen.getByText('Defeat')).toBeInTheDocument()
    expect(screen.queryByText(/Leading by/)).not.toBeInTheDocument()
  })
})
