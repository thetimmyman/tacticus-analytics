import type { APIEmbedField } from 'discord-api-types/v10'
import { MAX_TOKENS } from '@/app/lib/calculations/token-calculation'

const DISCORD_FIELD_VALUE_LIMIT = 1024
const DISCORD_MAX_FIELDS = 25

function formatTokenFraction(remaining: number, capacity: number): string {
  if (capacity <= 0) {
    return '0/0'
  }
  const safeRemaining = Math.max(0, Math.min(capacity, remaining))
  return `${safeRemaining}/${capacity}`
}

export function formatPlayerIdentifier(
  displayName: string,
  discordUserId: string | null | undefined,
  useMention: boolean
): string {
  if (useMention && discordUserId) {
    return `<@${discordUserId}>`
  }
  return displayName
}

/** 0 → "0", 1 → "⅓", 2 → "⅔", 3 → "3⁄3" */
function tokenFractionLabel(tokens: number): string {
  switch (tokens) {
    case 0:
      return '0'
    case 1:
      return '⅓'
    case 2:
      return '⅔'
    default:
      return '3⁄3'
  }
}

/** "1h 16m 29s" → "01h16m" (drops seconds, zero-pads). */
function compactCooldown(raw: string): string {
  const h = raw.match(/(\d+)h/)
  const m = raw.match(/(\d+)m/)
  const hours = h ? h[1]!.padStart(2, '0') : '00'
  const minutes = m ? m[1]!.padStart(2, '0') : '00'
  return `${hours}h${minutes}m`
}

export function formatTokenMemberLine(
  member: {
    displayName: string
    discordUserId?: string | null
    tokensAvailable: number
    bombsAvailable: number
    tokenCooldown: string | null
    bombCooldown: string | null
  },
  options: { useMention?: boolean } = {}
): string {
  const playerName = formatPlayerIdentifier(
    member.displayName,
    member.discordUserId,
    options.useMention ?? false
  )

  let tokenIcon: string
  if (member.tokensAvailable === 0) {
    tokenIcon = '❌'
  } else if (member.tokensAvailable >= 3) {
    tokenIcon = '⚠️'
  } else {
    tokenIcon = '✅'
  }

  const fraction = tokenFractionLabel(member.tokensAvailable)
  const tokenCooldownDisplay = member.tokenCooldown
    ? compactCooldown(member.tokenCooldown)
    : 'NONE..'
  const tokenStatus = `${tokenIcon} ${fraction} \`${tokenCooldownDisplay}\``

  // +Xh since ready, -Xh on cooldown, READY when never used.
  const bombIcon = member.bombsAvailable > 0 ? '✅' : '❌'
  let bombStatus: string
  if (!member.bombCooldown) {
    bombStatus = `${bombIcon} \`READY..\``
  } else {
    const prefix = member.bombsAvailable > 0 ? '+' : '-'
    bombStatus = `${bombIcon} \`${prefix}${compactCooldown(member.bombCooldown)}\``
  }

  return `${tokenStatus} - ${bombStatus} - ${playerName}`
}

export function formatBombLine(
  member: {
    displayName: string
    discordUserId?: string | null
    bombsAvailable: number
    bombCooldown: string | null
  },
  options: { useMention?: boolean } = {}
): string {
  const playerName = formatPlayerIdentifier(
    member.displayName,
    member.discordUserId,
    options.useMention ?? false
  )
  if (member.bombsAvailable > 0) {
    return `✅ \`READY..\` - ${playerName}`
  } else {
    const cd = member.bombCooldown ? compactCooldown(member.bombCooldown) : '--'
    return `❌ \`-${cd}\` - ${playerName}`
  }
}

// Current on-hand bank (same source as /tokens).
export function formatMatchLine(match: {
  displayName: string
  guildLabel: string
  tokensAvailable: number
  tokensUsed: number
  bombsAvailable: number
  tokenCooldown: string | null
  bombCooldown: string | null
}): string {
  const nextToken =
    match.tokensAvailable < MAX_TOKENS && match.tokenCooldown
      ? ` (next in ${match.tokenCooldown})`
      : ''
  const tokensSummary = `${formatTokenFraction(match.tokensAvailable, MAX_TOKENS)}${nextToken} (used ${match.tokensUsed})`
  const bombEmoji = match.bombsAvailable > 0 ? '💣' : '⏳'
  const bombLabel =
    match.bombsAvailable > 0
      ? 'Bomb ready'
      : `Bomb in ${match.bombCooldown ?? '--'}`
  return `**${match.displayName}** (${match.guildLabel}) - Tokens: ${tokensSummary} ${bombEmoji} ${bombLabel}`
}

export function formatLeaderboardLine(
  rank: number,
  label: string,
  value: string,
  meta?: string
): string {
  const suffix = meta ? ` (${meta})` : ''
  return `${rank}. ${label}: ${value}${suffix}`
}

export function formatAvailabilityLine(member: {
  displayName: string
  tokensRemaining: number
  tokenCapacity: number
  bombReady: boolean
  bombStatus: string
}): string {
  const tokensSummary = `${member.tokensRemaining}/${member.tokenCapacity}`
  const bombSummary = member.bombReady ? 'Ready' : member.bombStatus
  return `${member.displayName} - Tokens ${tokensSummary} | Bomb ${bombSummary}`
}

export function chunkLinesIntoFields(
  label: string,
  lines: string[],
  _options: { repeatLabel?: boolean } = {}
): APIEmbedField[] {
  if (lines.length === 0) {
    return [
      {
        name: label,
        value: 'No data available.'
      }
    ]
  }

  const fields: APIEmbedField[] = []
  let buffer: string[] = []
  let currentLength = 0
  let chunkIndex = 0

  const flush = () => {
    if (buffer.length === 0) return
    const name = chunkIndex === 0 ? label : '\u200b'
    fields.push({ name, value: buffer.join('\n') })
    buffer = []
    currentLength = 0
    chunkIndex += 1
  }

  lines.forEach((line) => {
    const addition = line.length + (buffer.length > 0 ? 1 : 0)
    if (
      buffer.length > 0 &&
      currentLength + addition > DISCORD_FIELD_VALUE_LIMIT
    ) {
      flush()
    }
    buffer.push(line)
    currentLength += addition
  })

  flush()
  return fields
}

export function assembleEmbedFields(
  overviewField: APIEmbedField,
  dataFields: APIEmbedField[],
  truncatedLabel: string
): APIEmbedField[] {
  if (dataFields.length === 0) {
    return [overviewField]
  }

  const maxWithoutSummary = DISCORD_MAX_FIELDS - 1
  if (dataFields.length <= maxWithoutSummary) {
    return [overviewField, ...dataFields]
  }

  const maxWithSummary = DISCORD_MAX_FIELDS - 2
  const truncatedCount = dataFields.length - maxWithSummary
  const summaryField: APIEmbedField = {
    name: truncatedLabel,
    value: `+${truncatedCount} additional group${truncatedCount === 1 ? '' : 's'} not shown due to Discord limits.`
  }

  return [overviewField, ...dataFields.slice(0, maxWithSummary), summaryField]
}

import {
  normalizeGuild as normalizeGuildBase,
  normalizeToUpper
} from '@/app/lib/utils/normalize'

export const normalizeGuild = (value: string) => normalizeGuildBase(value)
export const normalizeName = (value: string) => normalizeToUpper(value)

import { formatNumber as formatNumberCanonical } from '@/app/lib/utils/number-format'

export function formatCompactNumber(
  value: number | null | undefined,
  { decimals = 1 }: { decimals?: number } = {}
): string {
  return formatNumberCanonical(value, { style: 'compact', decimals })
}

export function formatList(
  items: string[] | undefined,
  { emptyLabel = 'None' }: { emptyLabel?: string } = {}
): string {
  if (!items || items.length === 0) {
    return emptyLabel ?? 'None'
  }
  if (items.length === 1) {
    return items[0] ?? emptyLabel ?? 'None'
  }
  if (items.length === 2) {
    const [first, second] = items
    return `${first ?? 'Unknown'} and ${second ?? 'Unknown'}`
  }
  const sanitizedItems = items.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  )
  if (sanitizedItems.length === 0) {
    return emptyLabel ?? 'None'
  }

  const allButLast = sanitizedItems.slice(0, -1).join(', ')
  const last = sanitizedItems[sanitizedItems.length - 1] ?? emptyLabel ?? 'None'
  return `${allButLast}, and ${last}`
}

export const calculateMedian = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length === 1) {
    return sorted[0] ?? 0
  }

  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? sorted[mid] ?? 0
    const right = sorted[mid] ?? left
    return (left + right) / 2
  }

  return sorted[mid] ?? 0
}

export const calculateStandardDeviation = (values: number[]): number => {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    values.length
  return Math.sqrt(variance)
}
