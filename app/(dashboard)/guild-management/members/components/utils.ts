import type { PlayerMapping } from '@tacticus/app-core/types'
import type { ExtendedMember } from './types'
import type { TokenUsageData, TokenUsageSummary, BombStatus } from './types'
import { TOKEN_CAP } from './types'

export function getApiKeyStatus(
  member: Pick<ExtendedMember, 'hasApiKey' | 'api_key_is_valid'>
): 'valid' | 'invalid' | 'missing' {
  if (!member.hasApiKey) return 'missing'
  if (member.api_key_is_valid === false) return 'invalid'
  return 'valid'
}

export function getTokenUsageSummary(
  member: PlayerMapping,
  tokenData: Record<string, TokenUsageData>
): TokenUsageSummary | null {
  const norm = (name?: string | null) => (name ?? '').trim().toLowerCase()
  const data =
    tokenData[member.display_name || ''] ||
    tokenData[member.player_id || ''] ||
    tokenData[member.user_id || ''] ||
    tokenData[`norm:${norm(member.display_name)}`]
  if (!data) return null

  const currentlyAvailable = Number.isFinite(
    data.tokens_available ?? data.tokens_used
  )
    ? Number(data.tokens_available ?? data.tokens_used)
    : null
  const max = TOKEN_CAP
  const nextSeconds = Number.isFinite(data.token_next_in_seconds ?? null)
    ? Number(data.token_next_in_seconds)
    : null

  if (currentlyAvailable === null && max === null) return null

  return {
    used: 0,
    max: max ?? null,
    available: Math.min(TOKEN_CAP, currentlyAvailable ?? 0),
    nextSeconds
  }
}

export function getBombStatus(
  member: PlayerMapping,
  tokenData: Record<string, TokenUsageData>
): BombStatus | null {
  const norm = (name?: string | null) => (name ?? '').trim().toLowerCase()
  const data =
    tokenData[member.display_name || ''] ||
    tokenData[member.player_id || ''] ||
    tokenData[member.user_id || ''] ||
    tokenData[`norm:${norm(member.display_name)}`]
  if (!data) return null

  const bombsAvailableRaw = data.bombs_available_live ?? data.bombs_available
  const bombsAvailable = Number.isFinite(bombsAvailableRaw)
    ? Number(bombsAvailableRaw)
    : null
  const bombsUsed = Number.isFinite(data.bombs_used)
    ? Number(data.bombs_used)
    : null
  const bombNextSeconds = Number.isFinite(data.bomb_next_in_seconds ?? null)
    ? Number(data.bomb_next_in_seconds)
    : null

  if (bombsAvailable === null && bombsUsed === null) return null

  return {
    available: (bombsAvailable ?? 0) > 0,
    used: bombsUsed ?? 0,
    nextSeconds: bombNextSeconds
  }
}

/** `||`, not `??`, is load-bearing: `searchParams.get` returns '' when present-but-empty. */
export function resolveSelectedSeason(
  urlSeason: string | null | undefined,
  initialSeason: string = ''
): string {
  return urlSeason || initialSeason
}

export function getPreferenceIcon(preference: string): string {
  switch (preference) {
    case 'preferred':
      return 'Prefer'
    case 'avoid':
      return 'Avoid'
    default:
      return 'Neutral'
  }
}

export function formatPerformancePercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${Math.round(value)}%`
}

export function getPerformanceColor(value: number): string {
  if (value >= 10) return 'text-green-400'
  if (value >= 0) return 'text-green-300'
  if (value >= -10) return 'text-yellow-400'
  return 'text-red-400'
}

export function formatRelativeTime(
  dateString: string | null | undefined
): string {
  if (!dateString) return 'Never'

  const date = new Date(dateString)
  if (isNaN(date.getTime())) return 'Never'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return `${Math.floor(diffDays / 30)}mo ago`
}
