import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import DownloadsClient, {
  detectPlatform
} from '../../app/downloads/DownloadsClient'
import { releaseDouble } from './fixtures.v1'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('accessible platform selection and honest availability', () => {
  it('detects mobile before desktop and leaves unknown agents undecided', () => {
    expect(detectPlatform('Android Linux')).toBe('android')
    expect(detectPlatform('iPhone Mac OS X')).toBe('ios')
    expect(detectPlatform('Macintosh Mobile')).toBe('ios')
    expect(detectPlatform('Windows')).toBe('windows')
    expect(detectPlatform('Macintosh')).toBe('macos')
    expect(detectPlatform('Linux')).toBe('linux')
    expect(detectPlatform('')).toBeNull()
  })

  it('supports manual override, architecture selection and all-platform support visibility', () => {
    render(
      <DownloadsClient
        initialState={{
          status: 'ready',
          channels: ['stable'],
          releases: [releaseDouble()]
        }}
      />
    )
    fireEvent.change(screen.getByLabelText('Operating system'), {
      target: { value: 'linux' }
    })
    expect(
      screen
        .getByRole('link', { name: 'Download Linux x64' })
        .getAttribute('href')
    ).toBe('/api/downloads/synthetic-linux-v1')
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.getByRole('rowheader', { name: 'iOS' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Operating system'), {
      target: { value: 'ios' }
    })
    expect(
      screen.queryByRole('link', { name: 'Download Linux x64' })
    ).toBeNull()
    expect(
      screen.getByText(/No qualified download is currently available/)
    ).toBeDefined()
    fireEvent.change(screen.getByLabelText('Operating system'), {
      target: { value: 'linux' }
    })
    fireEvent.change(screen.getByLabelText('Architecture'), {
      target: { value: 'arm64' }
    })
    expect(
      screen.queryByRole('link', { name: 'Download Linux x64' })
    ).toBeNull()
  })

  it('withdraws restored browser snapshots if the current server gate closes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    )
    render(
      <DownloadsClient
        initialState={{
          status: 'ready',
          channels: ['stable'],
          releases: [releaseDouble()]
        }}
      />
    )
    fireEvent.change(screen.getByLabelText('Operating system'), {
      target: { value: 'linux' }
    })
    expect(
      screen.getByRole('link', { name: 'Download Linux x64' })
    ).toBeDefined()
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })
    window.dispatchEvent(event)
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Download Linux x64' })
      ).toBeNull()
    )
    expect(fetch).toHaveBeenCalledWith(
      '/api/downloads/manifest',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('moves to a permitted channel when a refresh changes the channel policy', async () => {
    const stable = releaseDouble()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ready',
            channels: ['stable'],
            releases: [stable]
          })
        )
      )
    )
    render(
      <DownloadsClient
        initialState={{
          status: 'ready',
          channels: ['preview'],
          releases: []
        }}
      />
    )
    fireEvent.change(screen.getByLabelText('Operating system'), {
      target: { value: 'linux' }
    })
    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })
    window.dispatchEvent(event)
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Download Linux x64' })
      ).toBeDefined()
    )
  })
})
