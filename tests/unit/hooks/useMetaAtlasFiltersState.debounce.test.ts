import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ search: '' }))
const urlSync = vi.hoisted(() => ({ sync: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search)
}))

vi.mock('@/app/lib/hooks/useMetaUrlSync', () => ({
  useMetaUrlSync: urlSync.sync
}))

import { useMetaAtlasFiltersState } from '@/app/(dashboard)/meta-atlas/hooks/useMetaAtlasFiltersState'

describe('useMetaAtlasFiltersState debounced boss history', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    navigation.search = ''
    urlSync.sync.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('releases a type-then-clear intent that never emitted a navigation', () => {
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(null)
    )

    act(() => result.current.setBossFilter('Avatar'))
    act(() => result.current.setBossFilter(''))
    act(() => vi.advanceTimersByTime(300))

    expect(result.current.bossFilter).toBe('')
    expect(result.current.debouncedBossFilter).toBe('')

    navigation.search = 'boss=Screamer-Killer'
    rerender()
    expect(result.current.bossFilter).toBe('Screamer-Killer')
    expect(result.current.debouncedBossFilter).toBe('Screamer-Killer')
  })

  it('still waits for an already-emitted boss replacement before releasing the latest intent', () => {
    const { result, rerender } = renderHook(() =>
      useMetaAtlasFiltersState(null)
    )

    act(() => result.current.setBossFilter('Avatar'))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.debouncedBossFilter).toBe('Avatar')

    act(() => result.current.setBossFilter(''))

    // The older replacement lands first; the latest blank intent stays local.
    navigation.search = 'boss=Avatar'
    rerender()
    expect(result.current.bossFilter).toBe('')

    act(() => vi.advanceTimersByTime(300))
    navigation.search = ''
    rerender()
    expect(result.current.bossFilter).toBe('')

    navigation.search = 'boss=Szarekh'
    rerender()
    expect(result.current.bossFilter).toBe('Szarekh')
    expect(result.current.debouncedBossFilter).toBe('Szarekh')
  })
})
