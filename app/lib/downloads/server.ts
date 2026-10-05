import 'server-only'
import { open } from 'node:fs/promises'
import { connection } from 'next/server'
// eslint-disable-next-line no-restricted-imports -- The server-only boundary prevents client imports.
import { headers } from 'next/headers'
import { MAX_MANIFEST_BYTES } from './manifest'
import { downloadsPolicy } from './policy'
import { resolveDownloads, type DownloadsState } from './state'

export const DOWNLOADS_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'x-downloads-preview-token',
  'X-Robots-Tag': 'noindex'
}

async function readManifest(path: string): Promise<unknown> {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES)
      throw new Error('Manifest is not a bounded file')
    const data = Buffer.alloc(MAX_MANIFEST_BYTES + 1)
    const result = await file.read(data, 0, data.length, 0)
    if (result.bytesRead > MAX_MANIFEST_BYTES)
      throw new Error('Manifest is too large')
    return JSON.parse(data.subarray(0, result.bytesRead).toString('utf8'))
  } finally {
    await file.close()
  }
}

export async function getDownloadsState(
  previewToken?: string | null
): Promise<DownloadsState> {
  await connection()
  const requestToken =
    previewToken === undefined
      ? (await headers()).get('x-downloads-preview-token')
      : previewToken
  const policy = downloadsPolicy(process.env, requestToken)
  if (!policy.enabled) return { status: 'disabled', channels: [], releases: [] }
  try {
    const path = process.env.DOWNLOADS_MANIFEST_PATH
    if (!path) throw new Error('Missing release manifest')
    const keys: unknown = JSON.parse(
      process.env.DOWNLOADS_TRUSTED_KEYS_JSON || '{}'
    )
    if (
      !keys ||
      typeof keys !== 'object' ||
      Array.isArray(keys) ||
      Object.values(keys).some((key) => typeof key !== 'string')
    )
      throw new Error('Invalid manifest trust configuration')
    return resolveDownloads(
      await readManifest(path),
      policy,
      keys as Record<string, string>
    )
  } catch {
    return { status: 'unavailable', channels: policy.channels, releases: [] }
  }
}
