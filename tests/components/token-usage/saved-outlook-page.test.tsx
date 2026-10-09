import { beforeEach, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import TokenUsagePage from '@/app/(dashboard)/token-usage/page'

const { requireRole, getRuntimeProfile, checkFeatureAccess, tokenUsage } =
  vi.hoisted(() => ({
    requireRole: vi.fn(),
    getRuntimeProfile: vi.fn(),
    checkFeatureAccess: vi.fn(),
    tokenUsage: vi.fn()
  }))

vi.mock('@/app/lib/auth', () => ({ requireRole }))
vi.mock('@tacticus/app-core/runtime-profile', () => ({ getRuntimeProfile }))
vi.mock('@/app/lib/services/feature-release-service', () => ({
  checkFeatureAccess
}))
vi.mock('@/app/lib/utils/season', () => ({
  getLatestSeason: async () => '102'
}))
vi.mock('next/dynamic', () => ({
  default: () => (props: Record<string, unknown>) => {
    tokenUsage(props)
    return <div />
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue({
    user: { id: '00000000-0000-4000-8000-000000000101' },
    profile: {
      player_id: 'synthetic-officer',
      guild_code: 'SYNTH',
      role: 'officer'
    }
  })
  getRuntimeProfile.mockReturnValue('desktop')
  checkFeatureAccess.mockResolvedValue({ has_access: true })
})

it('admits a separate saved outlook on desktop without enabling the full forecast', async () => {
  render(
    await TokenUsagePage({ searchParams: Promise.resolve({ season: '101' }) })
  )

  expect(requireRole).toHaveBeenCalledWith('officer')
  expect(checkFeatureAccess).not.toHaveBeenCalled()
  expect(tokenUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      selectedGuild: 'SYNTH',
      selectedSeason: '101',
      showSavedOutlook: true,
      showForecast: false,
      savedOutlookContextKey: expect.any(String)
    })
  )
})

it('keeps hosted forecast entitlement separate from saved local availability', async () => {
  getRuntimeProfile.mockReturnValue('hosted')
  checkFeatureAccess.mockResolvedValue({ has_access: false })
  render(
    await TokenUsagePage({ searchParams: Promise.resolve({ season: '101' }) })
  )
  expect(checkFeatureAccess).toHaveBeenCalledWith(
    '00000000-0000-4000-8000-000000000101',
    'proactive_token_management'
  )
  expect(tokenUsage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      showSavedOutlook: false,
      showForecast: false,
      savedOutlookContextKey: undefined
    })
  )

  checkFeatureAccess.mockResolvedValue({ has_access: true })
  render(await TokenUsagePage({ searchParams: Promise.resolve({}) }))
  expect(tokenUsage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      showSavedOutlook: false,
      showForecast: true
    })
  )
})

it('fences saved results when the current caller or membership role changes', async () => {
  const props = { searchParams: Promise.resolve({ season: '101' }) }
  render(await TokenUsagePage(props))
  const originalKey = tokenUsage.mock.lastCall?.[0].savedOutlookContextKey
  expect(originalKey).toMatch(/^[a-f0-9]{64}$/)

  requireRole.mockResolvedValue({
    user: { id: '00000000-0000-4000-8000-000000000101' },
    profile: {
      player_id: 'synthetic-officer',
      guild_code: 'SYNTH',
      role: 'leader'
    }
  })
  render(await TokenUsagePage(props))
  expect(tokenUsage.mock.lastCall?.[0].savedOutlookContextKey).not.toBe(
    originalKey
  )

  requireRole.mockResolvedValue({
    user: { id: '00000000-0000-4000-8000-000000000102' },
    profile: {
      player_id: 'synthetic-other',
      guild_code: 'SYNTH',
      role: 'officer'
    }
  })
  render(await TokenUsagePage(props))
  expect(tokenUsage.mock.lastCall?.[0].savedOutlookContextKey).not.toBe(
    originalKey
  )
})

it('preserves the officer page boundary before admitting either calculation', async () => {
  requireRole.mockRejectedValue(new Error('Membership cannot open this page'))
  await expect(
    TokenUsagePage({ searchParams: Promise.resolve({}) })
  ).rejects.toThrow('Membership cannot open this page')
  expect(requireRole).toHaveBeenCalledWith('officer')
  expect(tokenUsage).not.toHaveBeenCalled()
  expect(checkFeatureAccess).not.toHaveBeenCalled()
})
