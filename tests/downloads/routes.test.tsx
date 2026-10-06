import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { getDownloadsState } from '../../app/lib/downloads/server'
import { GET as manifestGET } from '../../app/api/downloads/manifest/route'
import { GET as artifactGET } from '../../app/api/downloads/[releaseId]/route'
import DownloadsPage from '../../app/downloads/page'
import DownloadsNavigationEntry from '../../app/downloads/DownloadsNavigationEntry'
import { releaseDouble } from './fixtures.v1'

vi.mock('../../app/lib/downloads/server', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../app/lib/downloads/server')>()
  return { ...original, getDownloadsState: vi.fn() }
})

const loader = vi.mocked(getDownloadsState)
const request = new Request(
  'https://tacticusanalytics.com/api/downloads/manifest'
)

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('cache-safe unauthenticated downloads routes', () => {
  it('returns an honest direct-page unavailable state and hides navigation when disabled', async () => {
    loader.mockResolvedValue({ status: 'disabled', releases: [], channels: [] })
    render(await DownloadsPage())
    expect(screen.getByRole('status').textContent).toContain(
      'currently unavailable'
    )
    expect(screen.queryByRole('link', { name: /Download Linux/ })).toBeNull()
    expect(await DownloadsNavigationEntry()).toBeNull()
    const response = await manifestGET(request)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('x-downloads-preview-token')
    expect(await response.json()).toEqual({ status: 'disabled', releases: [] })
  })

  it('never exposes private candidate metadata when the manifest is absent or invalid', async () => {
    loader.mockResolvedValue({
      status: 'unavailable',
      releases: [],
      channels: ['stable']
    })
    const response = await manifestGET(request)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'unavailable',
      releases: []
    })
  })

  it('hands off only a currently qualified artifact and rechecks stale clicks after withdrawal', async () => {
    const release = releaseDouble()
    loader
      .mockResolvedValueOnce({
        status: 'ready',
        channels: ['stable'],
        releases: [release]
      })
      .mockResolvedValueOnce({ status: 'disabled', channels: [], releases: [] })
    const context = { params: Promise.resolve({ releaseId: release.id }) }
    const first = await artifactGET(request, context)
    expect(first.status).toBe(307)
    expect(first.headers.get('location')).toBe(release.artifact.url)
    expect(first.headers.get('cache-control')).toContain('no-store')
    const staleClick = await artifactGET(request, context)
    expect(staleClick.status).toBe(404)
    expect(staleClick.headers.get('location')).toBeNull()
  })

  it('rejects unknown IDs and forwards reviewer access only to the server loader', async () => {
    loader.mockResolvedValue({
      status: 'ready',
      channels: ['stable'],
      releases: [releaseDouble()]
    })
    const previewRequest = new Request(request.url, {
      headers: { 'x-downloads-preview-token': 'synthetic-review-header' }
    })
    const response = await artifactGET(previewRequest, {
      params: Promise.resolve({ releaseId: 'unknown' })
    })
    expect(response.status).toBe(404)
    expect(loader).toHaveBeenCalledWith('synthetic-review-header')
    const manifestResponse = await manifestGET(previewRequest)
    expect(JSON.stringify(await manifestResponse.json())).not.toContain(
      'synthetic-review-header'
    )
  })
})
