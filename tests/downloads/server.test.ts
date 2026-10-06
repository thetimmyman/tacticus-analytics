import { open, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDownloadsState } from '../../app/lib/downloads/server'
import { MAX_MANIFEST_BYTES } from '../../app/lib/downloads/manifest'
import { signedDouble, testNow } from './fixtures.v1'

vi.mock('next/server', () => ({
  connection: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers())
}))

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'downloads-test-'))
  vi.spyOn(Date, 'now').mockReturnValue(testNow)
  vi.stubEnv('DOWNLOADS_ENABLED', 'true')
  vi.stubEnv('DOWNLOADS_PREVIEW_ENABLED', 'false')
  vi.stubEnv('DOWNLOADS_READY_PLATFORMS', 'linux:stable')
  vi.stubEnv('DOWNLOADS_MANIFEST_PATH', join(directory, 'manifest.json'))
  vi.stubEnv('DOWNLOADS_TRUSTED_KEYS_JSON', '{}')
  vi.stubEnv('DOWNLOADS_REVOKED_RELEASE_IDS', '')
  vi.stubEnv('DOWNLOADS_MIN_GENERATED_AT', '')
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('server manifest loading without retained release cache', () => {
  it('returns disabled without needing a manifest or key', async () => {
    vi.stubEnv('DOWNLOADS_ENABLED', 'false')
    expect(await getDownloadsState(null)).toEqual({
      status: 'disabled',
      channels: [],
      releases: []
    })
  })

  it('fails closed for absent, malformed and oversized local manifests', async () => {
    expect((await getDownloadsState(null)).status).toBe('unavailable')
    await writeFile(join(directory, 'manifest.json'), '{invalid')
    expect((await getDownloadsState(null)).status).toBe('unavailable')
    await writeFile(
      join(directory, 'manifest.json'),
      ' '.repeat(MAX_MANIFEST_BYTES + 1)
    )
    expect((await getDownloadsState(null)).status).toBe('unavailable')
  })

  it('reads a manifest completely when the filesystem returns short reads', async () => {
    const { manifest, keys } = signedDouble()
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    vi.stubEnv('DOWNLOADS_TRUSTED_KEYS_JSON', JSON.stringify(keys))
    const probe = await open(join(directory, 'manifest.json'))
    const proto = Object.getPrototypeOf(probe) as {
      read: (...a: unknown[]) => Promise<unknown>
    }
    await probe.close()
    const realRead = proto.read
    vi.spyOn(proto, 'read').mockImplementation(function (
      this: unknown,
      buffer: unknown,
      offset: unknown,
      length: unknown,
      position: unknown
    ) {
      return realRead.call(
        this,
        buffer,
        offset,
        Math.min(Number(length), 100),
        position
      )
    })
    expect((await getDownloadsState(null)).releases).toHaveLength(1)
  })

  it('rereads atomic replacement and flag/withdrawal changes on every request', async () => {
    const { manifest, keys } = signedDouble()
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    vi.stubEnv('DOWNLOADS_TRUSTED_KEYS_JSON', JSON.stringify(keys))
    expect((await getDownloadsState(null)).releases).toHaveLength(1)
    vi.stubEnv('DOWNLOADS_REVOKED_RELEASE_IDS', 'synthetic-linux-v1')
    expect((await getDownloadsState(null)).releases).toHaveLength(0)
    vi.stubEnv('DOWNLOADS_REVOKED_RELEASE_IDS', '')
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ ...manifest, purpose: 'fixture' })
    )
    expect((await getDownloadsState(null)).status).toBe('unavailable')
  })
})
