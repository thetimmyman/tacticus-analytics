import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  resolveTheme,
  COLOR_PALETTE,
  HOMINA_POWERED_BY_TEXT
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import { resolveGuildContext } from '../../utils/guild-resolution'
import { normalizeName } from '../../utils/formatting'
import { fetchGuildTokens } from './fetch-guild-tokens'
import {
  TWELVE_HOURS_IN_SECONDS,
  MAX_TOKENS
} from '@/app/lib/calculations/token-calculation'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

const TOKEN_REGEN_SECONDS = TWELVE_HOURS_IN_SECONDS
const MAX_TOKENS_CAP = MAX_TOKENS

function formatDiscordTimestamp(date: Date) {
  const seconds = Math.floor(date.getTime() / 1000)
  return {
    absolute: `<t:${seconds}:T>`,
    relative: `<t:${seconds}:R>`
  }
}

function secondsToCap(
  tokensAvailable: number,
  maxTokens: number,
  tokenNextSeconds: number
): number {
  if (tokensAvailable >= maxTokens) return 0
  const slotsBeforeCap = maxTokens - tokensAvailable
  return (
    Math.max(0, tokenNextSeconds) + (slotsBeforeCap - 1) * TOKEN_REGEN_SECONDS
  )
}

export async function handleTimeToBurnCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const playerQuery = (
    getOptionValue(interaction.data.options, 'player') as string | undefined
  )?.trim()
  if (!playerQuery) {
    return buildErrorResponse('Please provide a player name.')
  }

  const requestedGuildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined

  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption,
    scope: 'tokens'
  })
  if (!guildResolution.ok) {
    return guildResolution.response
  }

  const targetGuildCode = guildResolution.guild.guildCode

  const tokensResult = await fetchGuildTokens(
    supabase,
    targetGuildCode,
    requestedSeason,
    guildResolution.guild.clusterCode
  )
  if (!tokensResult.ok) {
    return buildErrorResponse(tokensResult.message)
  }

  // Display only; matching uses the raw displayName.
  const memberLabels = await getMemberLabelMap()

  // Exact match first: a bare substring find picks an arbitrary player.
  const normalizedQuery = normalizeName(playerQuery)
  const exactPlayer = tokensResult.players.find(
    (p) => normalizeName(p.displayName) === normalizedQuery
  )
  const partialMatches = tokensResult.players.filter((p) =>
    normalizeName(p.displayName).includes(normalizedQuery)
  )
  const player =
    exactPlayer ?? (partialMatches.length === 1 ? partialMatches[0] : null)

  if (!player) {
    if (partialMatches.length > 1) {
      return buildErrorResponse(
        `Multiple players match "${playerQuery}" in guild ${targetGuildCode}: ${partialMatches
          .slice(0, 10)
          .map((p) => resolveMemberLabel(p.displayName, memberLabels))
          .join(', ')}. Please use the full name.`
      )
    }
    return buildErrorResponse(
      `No players matching "${playerQuery}" found in guild ${targetGuildCode}.`
    )
  }

  const tokensAvailable = player.tokensAvailable
  const tokenNextSeconds = player.tokenNextSeconds
  const now = Date.now()
  const theme = resolveTheme(targetGuildCode)

  const lines: string[] = [
    `Guild: ${targetGuildCode}`,
    `Player: ${resolveMemberLabel(player.displayName, memberLabels)}`,
    `Tokens on hand: ${tokensAvailable}/${MAX_TOKENS_CAP}`,
    ''
  ]

  let isBurningOrAtRisk = false

  if (tokensAvailable >= MAX_TOKENS_CAP) {
    isBurningOrAtRisk = true
    if (tokenNextSeconds === null || tokenNextSeconds <= 0) {
      lines.push(
        '\u{1F525} **Already burning** — next token will be lost immediately unless spent.'
      )
    } else {
      const burnAt = new Date(now + tokenNextSeconds * 1000)
      const ts = formatDiscordTimestamp(burnAt)
      lines.push(`\u{1F525} Next burned token ${ts.relative} (${ts.absolute}).`)
    }
    lines.push('Subsequent burns follow every 12h while you remain at cap.')
  } else if (tokenNextSeconds === null) {
    lines.push('Regeneration timer unavailable — cannot forecast burn.')
  } else {
    const toCap = secondsToCap(
      tokensAvailable,
      MAX_TOKENS_CAP,
      tokenNextSeconds
    )
    const capAt = new Date(now + toCap * 1000)
    const burnAt = new Date(capAt.getTime() + TOKEN_REGEN_SECONDS * 1000)
    const capTs = formatDiscordTimestamp(capAt)
    const burnTs = formatDiscordTimestamp(burnAt)
    lines.push('✅ Not currently capped — no burn scheduled.')
    lines.push(`Reach cap ${capTs.relative} (${capTs.absolute}).`)
    lines.push(
      `If you stay capped after that, first burn would be ${burnTs.relative} (${burnTs.absolute}).`
    )
  }

  return createCommandResponse(theme, {
    title: `Time to Token Burn — ${resolveMemberLabel(player.displayName, memberLabels)}`,
    description: lines.join('\n'),
    color: isBurningOrAtRisk ? COLOR_PALETTE.danger : COLOR_PALETTE.success,
    footer: HOMINA_POWERED_BY_TEXT,
    useThemeAccent: false
  })
}
