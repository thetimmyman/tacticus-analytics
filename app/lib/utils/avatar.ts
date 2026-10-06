import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

interface AvatarOptions {
  name: string
  size?: number
  background?: string
  color?: string
  bold?: boolean
  uppercase?: boolean
  format?: 'svg' | 'png'
}

export function getAvatarUrl(options: AvatarOptions): string {
  const {
    name,
    size = 40,
    background,
    color = 'ffffff',
    bold = true,
    uppercase = true,
    format = 'png'
  } = options

  const initials = name
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  if (getRuntimeProfile() === 'desktop') {
    const dimension = Number.isFinite(size)
      ? Math.min(512, Math.max(8, Math.round(size)))
      : 40
    const safeColor = (value: string | undefined, fallback: string) =>
      value && /^[a-f0-9]{6}$/i.test(value) ? value : fallback
    const text = (uppercase ? initials.toUpperCase() : initials).replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;'
        })[character]!
    )
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#${safeColor(background, '6B7280')}"/><text x="50" y="54" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="40" font-weight="${bold ? 700 : 400}" fill="#${safeColor(color, 'FFFFFF')}">${text || 'U'}</text></svg>`
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  }

  const params = new URLSearchParams({
    name: uppercase ? initials.toUpperCase() : initials,
    size: size.toString(),
    color,
    bold: bold.toString(),
    format
  })

  if (background) {
    params.append('background', background)
  } else {
    params.append('background', 'random')
  }

  const avatarBaseUrl =
    process.env.NEXT_PUBLIC_AVATAR_API_URL || 'https://ui-avatars.com/api'
  return `${avatarBaseUrl}/?${params.toString()}`
}

export function getGuildColor(guildCode: string): string {
  const guildColors: Record<string, string> = {
    IW: '6B7280', // Iron Warriors - Iron/Grey
    NL: '1E3A8A', // Night Lords - Midnight Blue
    WB: '991B1B', // Word Bearers - Dark Red
    DG: '14532D', // Death Guard - Plague Green
    TS: '7C3AED', // Thousand Sons - Purple/Blue
    WE: 'DC2626', // World Eaters - Blood Red
    EC: 'DB2777', // Emperor's Children - Pink/Purple
    AL: '059669', // Alpha Legion - Teal
    BL: '1F2937', // Black Legion - Black/Dark Grey

    UM: '2563EB', // Ultramarines - Blue
    IF: 'F59E0B', // Imperial Fists - Yellow
    DA: '064E3B', // Dark Angels - Dark Green
    SW: '6B7280', // Space Wolves - Grey
    SAL: '65A30D', // Salamanders - Green
    IH: '1F2937', // Iron Hands - Black
    RG: '1F2937', // Raven Guard - Black
    WS: 'FFFFFF', // White Scars - White

    EOT: '7C3AED', // Eternal Odyssey Tale - Purple
    GLOBAL: '6B7280', // Global/Default - Neutral Grey

    DEFAULT: '6B7280'
  }

  const defaultColor = guildColors.DEFAULT ?? '6B7280'
  return guildColors[guildCode.toUpperCase()] ?? defaultColor
}

export function getUserAvatar(
  displayName: string,
  guildCode: string = 'GLOBAL',
  size: number = 40
): string {
  return getAvatarUrl({
    name: displayName,
    size,
    background: getGuildColor(guildCode),
    color: 'ffffff',
    bold: true,
    uppercase: true
  })
}

/** Only an explicitly configured, release-approved sprite set; deliberately no third-party default. */
export function getDatamineAvatarUrl(avatarUnitId: string): string | null {
  const configuredBase =
    process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL?.trim()
  if (!configuredBase) return null
  if (getRuntimeProfile() === 'desktop' && !localAvatarAsset(configuredBase))
    return null

  const base = configuredBase.replace(/\/+$/, '')
  return `${base}/ui_avatar_${encodeURIComponent(avatarUnitId)}.png`
}

export interface AvatarFrame {
  avatar_id: string
  icon_url: string | null
}

export type AvatarFrameMap = Map<string, string> | Record<string, string>

function lookupFrameIcon(
  frameMap: AvatarFrameMap,
  avatarId: string
): string | null {
  const icon =
    frameMap instanceof Map ? frameMap.get(avatarId) : frameMap[avatarId]
  return icon && (getRuntimeProfile() !== 'desktop' || localAvatarAsset(icon))
    ? icon
    : null
}

function localAvatarAsset(value: string): boolean {
  return (
    value.startsWith('/images/') &&
    !value.includes('\\') &&
    new URL(value, 'http://127.0.0.1').pathname.startsWith('/images/')
  )
}

/** Strips premium suffixes (`..._premium_2` → base); frames store only base ids for some variants. */
export function normalizeAvatarUnitId(avatarUnitId: string): string {
  return avatarUnitId.replace(/_premium_\d+$/, '').replace(/_premium$/, '')
}

export function buildAvatarFrameMap(
  frames: readonly AvatarFrame[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const frame of frames) {
    if (frame.avatar_id && frame.icon_url) {
      map.set(frame.avatar_id, frame.icon_url)
    }
  }
  return map
}

export async function resolveAvatarFrameMap(
  supabase: TypedSupabaseClient,
  avatarUnitId: string
): Promise<Map<string, string>> {
  const baseId = normalizeAvatarUnitId(avatarUnitId)
  const ids = baseId === avatarUnitId ? [avatarUnitId] : [avatarUnitId, baseId]
  const { data } = await supabase
    .from('player_avatar_frames')
    .select('avatar_id, icon_url')
    .in('avatar_id', ids)

  return buildAvatarFrameMap(data ?? [])
}

export interface AvatarResolveOptions {
  datamineFallback?: boolean
}

/** Exact id → premium base id → approved sprite URL; null means callers fall back to initials. */
export function resolveAvatarIconUrl(
  avatarUnitId: string | null | undefined,
  frameMap?: AvatarFrameMap,
  options?: AvatarResolveOptions
): string | null {
  if (!avatarUnitId) return null

  if (frameMap) {
    const exact = lookupFrameIcon(frameMap, avatarUnitId)
    if (exact) return exact

    const baseId = normalizeAvatarUnitId(avatarUnitId)
    if (baseId !== avatarUnitId) {
      const base = lookupFrameIcon(frameMap, baseId)
      if (base) return base
    }
  }

  if (options?.datamineFallback === false) return null

  return getDatamineAvatarUrl(avatarUnitId)
}

export interface ResolvePlayerAvatarOptions {
  avatarUnitId?: string | null
  playerName: string
  guildCode?: string
  size?: number
  frameMap?: AvatarFrameMap
  datamineFallback?: boolean
}

/** Exact id → premium base → approved sprite → initials; no third-party host without a sprite base. */
export function resolvePlayerAvatar(
  options: ResolvePlayerAvatarOptions
): string {
  const {
    avatarUnitId,
    playerName,
    guildCode = 'GLOBAL',
    size = 40,
    frameMap,
    datamineFallback
  } = options

  return (
    resolveAvatarIconUrl(avatarUnitId, frameMap, { datamineFallback }) ??
    getUserAvatar(playerName, guildCode, size)
  )
}

export function getAvatarWithFallback(
  avatarUrl: string | null | undefined,
  displayName: string,
  guildCode: string = 'GLOBAL',
  size: number = 40
): string {
  if (getRuntimeProfile() === 'desktop')
    return avatarUrl && localAvatarAsset(avatarUrl)
      ? avatarUrl
      : getUserAvatar(displayName, guildCode, size)
  if (avatarUrl && avatarUrl.startsWith('http')) {
    return avatarUrl
  }

  return getUserAvatar(displayName, guildCode, size)
}
