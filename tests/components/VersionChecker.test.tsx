import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VersionChecker } from '@/app/components/VersionChecker'

const BUILD_STORAGE_KEY = 'app-build-id'
const REFRESH_TOKEN_STORAGE_KEY = 'app-refresh-required-token'
const DISMISSED_REFRESH_TOKEN_STORAGE_KEY =
  'app-dismissed-refresh-required-token'
const REFRESH_BANNER_TEXT = 'A refresh is required to apply the latest update.'

const buildVersionResponse = (
  buildId: string,
  refreshRequiredToken: string | null = null
) => ({
  ok: true,
  json: async () => ({
    buildId,
    buildTime: '2026-03-17T00:00:00.000Z',
    version: '1.41.29',
    refreshRequiredToken
  })
})

describe('VersionChecker', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    const storage = new Map<string, string>()

    localStorage.getItem = vi.fn((key: string) => storage.get(key) ?? null)
    localStorage.setItem = vi.fn((key: string, value: string) => {
      storage.set(key, value)
    })
    localStorage.removeItem = vi.fn((key: string) => {
      storage.delete(key)
    })
    localStorage.clear = vi.fn(() => {
      storage.clear()
    })

    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('stores the first seen build without showing a banner', async () => {
    fetchMock.mockResolvedValue(buildVersionResponse('build-1'))

    render(<VersionChecker />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(screen.queryByText(REFRESH_BANNER_TEXT)).not.toBeInTheDocument()
    expect(localStorage.getItem(BUILD_STORAGE_KEY)).toBe('build-1')
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('silently accepts ordinary deploys when no refresh token changes', async () => {
    localStorage.setItem(BUILD_STORAGE_KEY, 'build-1')
    fetchMock.mockResolvedValue(buildVersionResponse('build-2'))

    render(<VersionChecker />)

    await waitFor(() =>
      expect(localStorage.getItem(BUILD_STORAGE_KEY)).toBe('build-2')
    )

    expect(screen.queryByText(REFRESH_BANNER_TEXT)).not.toBeInTheDocument()
  })

  it('shows the banner when a new build advances refreshRequiredToken', async () => {
    localStorage.setItem(BUILD_STORAGE_KEY, 'build-1')
    fetchMock.mockResolvedValue(
      buildVersionResponse('build-2', 'refresh-2026-03-17')
    )

    render(<VersionChecker />)

    expect(await screen.findByText(REFRESH_BANNER_TEXT)).toBeInTheDocument()
    expect(localStorage.getItem(BUILD_STORAGE_KEY)).toBe('build-1')
  })

  it('persists dismissals for the current refresh-required update', async () => {
    localStorage.setItem(BUILD_STORAGE_KEY, 'build-1')
    fetchMock.mockResolvedValue(
      buildVersionResponse('build-2', 'refresh-2026-03-17')
    )

    const { unmount } = render(<VersionChecker />)

    expect(await screen.findByText(REFRESH_BANNER_TEXT)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /later/i }))

    expect(screen.queryByText(REFRESH_BANNER_TEXT)).not.toBeInTheDocument()
    expect(localStorage.getItem(DISMISSED_REFRESH_TOKEN_STORAGE_KEY)).toBe(
      'refresh-2026-03-17'
    )

    unmount()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      buildVersionResponse('build-2', 'refresh-2026-03-17')
    )

    render(<VersionChecker />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(localStorage.getItem(BUILD_STORAGE_KEY)).toBe('build-2')
    )

    expect(screen.queryByText(REFRESH_BANNER_TEXT)).not.toBeInTheDocument()
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe(
      'refresh-2026-03-17'
    )
    expect(localStorage.getItem(DISMISSED_REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })
})
