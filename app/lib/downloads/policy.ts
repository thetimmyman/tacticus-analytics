import { timingSafeEqual } from 'node:crypto'
import { channels, platforms, type Channel, type Platform } from './schema'

export type DownloadsPolicy = {
  enabled: boolean
  channels: Channel[]
  ready: string[]
  revoked: string[]
  minimumGeneratedAt: number
}

export function downloadsPolicy(
  env: Record<string, string | undefined>,
  previewToken: string | null = null
): DownloadsPolicy {
  const token = env.DOWNLOADS_PREVIEW_TOKEN
  const trusted = Buffer.from(token || '')
  const supplied = Buffer.from(previewToken || '')
  const preview =
    env.DOWNLOADS_PREVIEW_ENABLED === 'true' &&
    trusted.length >= 32 &&
    trusted.length === supplied.length &&
    timingSafeEqual(trusted, supplied)
  const allowedChannels: Channel[] = []
  if (env.DOWNLOADS_ENABLED === 'true') allowedChannels.push('stable')
  if (preview) allowedChannels.push('preview')
  const ready = (env.DOWNLOADS_READY_PLATFORMS || '').split(',').filter(Boolean)
  const revoked = (env.DOWNLOADS_REVOKED_RELEASE_IDS || '')
    .split(',')
    .filter(Boolean)
  const minimumGeneratedAt = env.DOWNLOADS_MIN_GENERATED_AT
    ? Date.parse(env.DOWNLOADS_MIN_GENERATED_AT)
    : 0
  const validReadiness = ready.every((entry) => {
    const parts = entry.split(':')
    return (
      parts.length === 2 &&
      platforms.includes(parts[0] as Platform) &&
      channels.includes(parts[1] as Channel)
    )
  })
  const validRevocation = revoked.every((id) =>
    /^[a-z0-9][a-z0-9.-]{0,79}$/.test(id)
  )
  return {
    enabled:
      allowedChannels.length > 0 &&
      validReadiness &&
      validRevocation &&
      Number.isFinite(minimumGeneratedAt),
    channels: allowedChannels,
    ready: validReadiness ? ready : [],
    revoked,
    minimumGeneratedAt
  }
}
