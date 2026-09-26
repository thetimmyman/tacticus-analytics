import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeamFormDialog from './TeamFormDialog'
import type { HeroCatalog } from '@/app/lib/catalogs'
import type { TeamPayload } from './types'

const catalog = {
  getAll: () => [
    {
      unitId: 'alpha',
      displayName: 'Alpha',
      category: 'hero'
    }
  ],
  getById: (unitId: string) =>
    unitId === 'alpha'
      ? { unitId: 'alpha', displayName: 'Alpha', category: 'hero' }
      : undefined
} as unknown as HeroCatalog

const onOpenChange = vi.fn()
const onSave = vi.fn<(payload: TeamPayload) => Promise<void>>()

describe('TeamFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('can select the same hero again after removing it', async () => {
    const user = userEvent.setup()
    render(
      <TeamFormDialog
        team={null}
        catalog={catalog}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    )

    const addHero = () => screen.getByRole('combobox', { name: 'Heroes' })
    await user.click(addHero())
    await user.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(screen.getByText('Alpha')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    expect(screen.queryByRole('button', { name: 'Remove Alpha' })).toBeNull()

    await user.click(addHero())
    await user.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(screen.getByText('Alpha')).toBeTruthy()
  })
})
