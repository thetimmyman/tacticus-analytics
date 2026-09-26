'use client'

import { KeyRound } from 'lucide-react'
import { getApiKeyStatus } from './utils'
import type { ExtendedMember } from './types'

export function renderApiKeyIndicator(member: ExtendedMember) {
  const status = getApiKeyStatus(member)

  switch (status) {
    case 'valid':
      return (
        <span
          className="inline-flex items-center text-amber-400 drop-shadow-sm"
          title="Valid Player API Key - Token data available"
        >
          <KeyRound className="h-4 w-4" />
        </span>
      )
    case 'invalid':
      return (
        <span
          className="inline-flex items-center text-red-400 drop-shadow-sm"
          title="Invalid Player API Key - Token data unavailable, key needs updating"
        >
          <KeyRound className="h-4 w-4" />
        </span>
      )
    case 'missing':
    default:
      return null
  }
}

export function getBossPreferences(member: ExtendedMember) {
  const preferences = member.boss_preferences
  if (
    !preferences ||
    typeof preferences !== 'object' ||
    Array.isArray(preferences)
  ) {
    return []
  }

  return Object.entries(preferences)
    .filter(
      (entry): entry is [string, 'preferred' | 'avoid'] =>
        entry[0].startsWith('main_') &&
        (entry[1] === 'preferred' || entry[1] === 'avoid')
    )
    .map(([key, value]) => ({
      boss: key.replace('main_', ''),
      preference: value
    }))
    .slice(0, 3)
}

export function getAvailabilityMissingReason(
  member: ExtendedMember,
  tokenDataError?: string | null
) {
  if (tokenDataError) return 'Token data service error'
  const keyStatus = getApiKeyStatus(member)
  if (keyStatus === 'missing') return 'Missing Player API Key'
  if (keyStatus === 'invalid') return 'Invalid Player API Key'
  return 'No battles this season'
}
