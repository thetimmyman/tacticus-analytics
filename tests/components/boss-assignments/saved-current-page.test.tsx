import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CurrentAssignmentsPage from '@/app/(dashboard)/boss-assignments/current/page'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { getSavedQueuePageContext } from '@/app/lib/boss-assignments/saved-queue'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { Errors } from '@/app/lib/errors/AppError'

const mocks = vi.hoisted(() => ({ client: vi.fn(), hosted: vi.fn() }))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: vi.fn(() => 'desktop')
}))
vi.mock('@/app/lib/boss-assignments/saved-queue', () => ({
  getSavedQueuePageContext: vi.fn()
}))
vi.mock('@/app/(dashboard)/boss-assignments/_lib/access', () => ({
  requireBossAssignmentsAccess: vi.fn(async () => ({
    profile: { guild_code: 'SYNTHETIC-GUILD' },
    canEdit: true
  }))
}))
vi.mock('@/app/(dashboard)/boss-assignments/BossAssignments', () => ({
  BossAssignments: (props: unknown) => {
    mocks.hosted(props)
    return <div>Hosted queue loader</div>
  }
}))
vi.mock(
  '@/app/(dashboard)/boss-assignments/current/SavedCurrentQueueClient',
  () => ({
    default: (props: unknown) => {
      mocks.client(props)
      return <section aria-label="Dedicated saved current queue" />
    }
  })
)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntimeProfile).mockReturnValue('desktop')
  vi.mocked(getSavedQueuePageContext).mockResolvedValue({
    source: 'saved-local',
    seasons: ['102', '101'],
    season: '101',
    canCalculate: false,
    contextKey: 'opaque-current-context'
  })
})
async function page(
  params: Record<string, string | string[] | undefined> = {}
) {
  render(
    await CurrentAssignmentsPage({ searchParams: Promise.resolve(params) })
  )
}
describe('desktop current queue page admission', () => {
  it('mounts only the dedicated saved client with server-derived member capabilities', async () => {
    await page({ season: '101' })
    expect(
      screen.getByRole('region', { name: 'Dedicated saved current queue' })
    ).toBeInTheDocument()
    expect(getSavedQueuePageContext).toHaveBeenCalledWith({
      selectedSeason: '101'
    })
    expect(mocks.client).toHaveBeenCalledWith({
      season: '101',
      seasons: ['102', '101'],
      contextKey: 'opaque-current-context',
      canCalculate: false
    })
    expect(requireBossAssignmentsAccess).not.toHaveBeenCalled()
    expect(mocks.hosted).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('opaque-current-context')
  })
  it('uses the server selected newest captured imported default without a client current-season fallback', async () => {
    vi.mocked(getSavedQueuePageContext).mockResolvedValue({
      source: 'saved-local',
      seasons: ['102', '101'],
      season: '102',
      canCalculate: true,
      contextKey: 'officer-context'
    })
    await page()
    expect(getSavedQueuePageContext).toHaveBeenCalledWith({
      selectedSeason: undefined
    })
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ season: '102', canCalculate: true })
    )
  })
  it('shows import guidance without mounting a model or client when no captured imported season exists', async () => {
    vi.mocked(getSavedQueuePageContext).mockResolvedValue({
      source: 'saved-local',
      seasons: [],
      season: null,
      canCalculate: true,
      contextKey: 'officer-context'
    })
    await page()
    expect(screen.getByText('Import saved raid history')).toBeInTheDocument()
    expect(screen.getByText(/API access and sync/)).toBeInTheDocument()
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('refuses unsupported explicit season selection without substituting another saved season', async () => {
    vi.mocked(getSavedQueuePageContext).mockRejectedValue(
      Errors.unprocessable('PRIVATE_INVALID_SEASON_CANARY')
    )
    await page({ season: '9999' })
    expect(screen.getByText('Saved season unavailable')).toBeInTheDocument()
    expect(mocks.client).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('PRIVATE_INVALID_SEASON_CANARY')
  })
  it('rejects duplicate season query values before any saved context or hosted loader call', async () => {
    await page({ season: ['101', '102'] })
    expect(screen.getByText('Saved season unavailable')).toBeInTheDocument()
    expect(getSavedQueuePageContext).not.toHaveBeenCalled()
    expect(mocks.hosted).not.toHaveBeenCalled()
  })
  it('does not disguise denied authentication as an empty saved workspace', async () => {
    vi.mocked(getSavedQueuePageContext).mockRejectedValue(
      Errors.forbidden('Saved access refused')
    )
    await expect(
      CurrentAssignmentsPage({ searchParams: Promise.resolve({}) })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('preserves hosted access/profile/current-mode and explicit season behavior without local context calls', async () => {
    vi.mocked(getRuntimeProfile).mockReturnValue('hosted')
    await page({ season: '9999' })
    expect(screen.getByText('Hosted queue loader')).toBeInTheDocument()
    expect(requireBossAssignmentsAccess).toHaveBeenCalledOnce()
    expect(mocks.hosted).toHaveBeenCalledWith({
      profile: { guild_code: 'SYNTHETIC-GUILD' },
      mode: 'current',
      canEdit: true,
      seasonOverride: '9999'
    })
    expect(getSavedQueuePageContext).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
