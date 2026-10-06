import { releaseBlockers, validateManifest } from './manifest'
import { type DownloadsPolicy } from './policy'
import { type Release, type Channel } from './schema'

export type DownloadsState = {
  status: 'disabled' | 'unavailable' | 'ready'
  channels: Channel[]
  releases: Release[]
  generatedAt?: string
  expiresAt?: string
}

export function resolveDownloads(
  input: unknown,
  policy: DownloadsPolicy,
  trustedKeys: Record<string, string>,
  now = Date.now()
): DownloadsState {
  if (!policy.enabled) return { status: 'disabled', channels: [], releases: [] }
  try {
    const manifest = validateManifest(input, trustedKeys, now)
    if (Date.parse(manifest.payload.generatedAt) < policy.minimumGeneratedAt)
      throw new Error('Manifest predates withdrawal floor')
    const releases = manifest.payload.releases.filter(
      (release) =>
        policy.channels.includes(release.channel) &&
        policy.ready.includes(`${release.platform}:${release.channel}`) &&
        !policy.revoked.includes(release.id) &&
        releaseBlockers(release).length === 0
    )
    return {
      status: 'ready',
      channels: policy.channels,
      releases,
      generatedAt: manifest.payload.generatedAt,
      expiresAt: manifest.payload.expiresAt
    }
  } catch {
    return { status: 'unavailable', channels: policy.channels, releases: [] }
  }
}
