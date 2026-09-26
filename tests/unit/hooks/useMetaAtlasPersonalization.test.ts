import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const usePlayerCurrentTeams = vi.hoisted(() => vi.fn())

vi.mock('@/app/(dashboard)/meta-atlas/hooks/usePlayerCurrentTeams', () => ({
  usePlayerCurrentTeams
}))

import { useMetaAtlasPersonalization } from '@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasPersonalization'

describe('useMetaAtlasPersonalization', () => {
  beforeEach(() => {
    usePlayerCurrentTeams.mockReset()
    usePlayerCurrentTeams.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetched: false,
      isError: false
    })
  })

  it('defers current-team personalization until its view is enabled', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useMetaAtlasPersonalization({
          season: '106',
          canPersonalize: true,
          enabled,
          rosterEntries: [],
          rosterSignature: '',
          rosterNames: []
        }),
      { initialProps: { enabled: false } }
    )

    expect(usePlayerCurrentTeams).toHaveBeenLastCalledWith('106', false)
    expect(result.current.personalizedEnabled).toBe(false)
    expect(result.current.personalizedPayload).toBeUndefined()

    rerender({ enabled: true })
    expect(usePlayerCurrentTeams).toHaveBeenLastCalledWith('106', true)
  })
})
