import {
  type PlayerNameMap,
  resolveDisplayName
} from '../_shared/player-name-resolution.ts'
import { relabelForDisplay } from '../_shared/duplicate-name-labels.ts'
import { InteractionResponseType } from '../_shared/discord-auth.ts'
import { sendFollowUpMessage } from '../_shared/discord-webhook.ts'
import {
  formatCompactNumber,
  formatDurationShort,
  formatIntervalDuration,
  formatList,
  formatPercentage,
  formatRelativeDuration
} from '../_shared/formatters.ts'

import {
  formatGuildLabel,
  getGuildMapping,
  verifyUserPermissions,
  type DiscordCommandContext
} from './command-context.ts'

export function resolveDisplayNameWithMap(
  displayName: string | null,
  userId: string | null,
  playerNameMap: PlayerNameMap
): string {
  return resolveDisplayName(displayName, userId, playerNameMap)
}

let cachedSeason: { value: string; timestamp: number } | null = null
export const SEASON_CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
export async function getCurrentSeason(supabase: any): Promise<string> {
  const now = Date.now()
  if (cachedSeason && now - cachedSeason.timestamp < SEASON_CACHE_DURATION) {
    return cachedSeason.value
  }
  // Use the RPC: "Season" is TEXT, so a plain MAX lex-sorts.
  const { data, error } = await supabase.rpc('get_latest_season')
  if (error || !data) {
    throw new Error(
      `Failed to fetch current season: ${error?.message ?? 'RPC returned null'}`
    )
  }
  const season = String(data)
  cachedSeason = { value: season, timestamp: now }
  return season
}
export function calculateBombTimer(lastUsed: string | null): string | null {
  if (!lastUsed) return null
  const now = new Date()
  const lastBombTime = new Date(lastUsed)
  const timeSince = now.getTime() - lastBombTime.getTime()
  const eighteenHours = 18 * 60 * 60 * 1000
  if (timeSince >= eighteenHours) {
    return null // Bomb available
  }
  const timeRemaining = eighteenHours - timeSince
  const hours = Math.floor(timeRemaining / (60 * 60 * 1000))
  const minutes = Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000))
  return `${hours}h${minutes.toString().padStart(2, '0')}m`
}
export async function sendFollowupMessage(token: string, data: any) {
  const applicationId =
    Deno.env.get('DISCORD_APPLICATION_ID') || '1362473802243637389'
  await sendFollowUpMessage(
    applicationId,
    token,
    data.content || '',
    data.embeds || null,
    data.flags || null
  )
}

export const EMBED_FIELD_SAFE_LENGTH = 900

export type LineChunk = {
  value: string
  start: number
  end: number
}

export function chunkLines(
  lines: string[],
  maxLength = EMBED_FIELD_SAFE_LENGTH
): LineChunk[] {
  const chunks: LineChunk[] = []
  let buffer: string[] = []
  let currentLength = 0
  let chunkStartIndex = 0

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd()
    if (!line) {
      return
    }

    const projectedLength =
      currentLength + line.length + (buffer.length > 0 ? 1 : 0)

    if (projectedLength > maxLength) {
      if (buffer.length > 0) {
        const start = chunkStartIndex + 1
        const end = chunkStartIndex + buffer.length
        chunks.push({
          value: buffer.join('\n'),
          start,
          end
        })
      }
      buffer = [line]
      currentLength = line.length
      chunkStartIndex = index
    } else {
      if (buffer.length > 0) {
        currentLength += 1
      }
      buffer.push(line)
      currentLength += line.length
    }
  })

  if (buffer.length > 0) {
    const start = chunkStartIndex + 1
    const end = chunkStartIndex + buffer.length
    chunks.push({
      value: buffer.join('\n'),
      start,
      end
    })
  }

  return chunks
}

export const TOKENS_PER_SEASON_CAP = 28
export const TOKEN_REGEN_SECONDS = 12 * 60 * 60

export type GuildMemberAvailability = {
  rawDisplayName: string
  displayName: string
  tokensUsed: number
  tokensRemaining: number
  tokenCapacity: number
  bombReady: boolean
  bombStatus: string
}

export type GuildAvailabilitySummary = {
  label: string
  normalizedGuild: string
  members: GuildMemberAvailability[]
  totalTokensRemaining: number
  totalBombsReady: number
}

export type AvailabilitySuccess = {
  ok: true
  season: string
  requestedGuildUpper: string
  requestedGuildLabel: string
  guilds: GuildAvailabilitySummary[]
  totals: {
    players: number
    tokensReady: number
    bombsReady: number
  }
}

export type AvailabilityError = {
  ok: false
  message: string
}

export type AvailabilityResult = AvailabilitySuccess | AvailabilityError

export function calculateSecondsToCap(
  tokensAvailable: number,
  maxTokens: number,
  nextTokenInSeconds: number | null | undefined
): number | null {
  if (tokensAvailable >= maxTokens) {
    return 0
  }
  if (nextTokenInSeconds === null || nextTokenInSeconds === undefined) {
    return null
  }
  const slotsUntilFull = Math.max(0, maxTokens - tokensAvailable - 1)
  return nextTokenInSeconds + slotsUntilFull * TOKEN_REGEN_SECONDS
}

export async function fetchGuildAvailability(
  context: DiscordCommandContext,
  permissions: { accessibleGuilds: string[] },
  requestedGuild: string,
  requestedSeason: string | undefined
): Promise<AvailabilityResult> {
  const supabase = context.supabase
  const accessibleGuilds = permissions.accessibleGuilds || []
  if (accessibleGuilds.length === 0) {
    return {
      ok: false,
      message: 'No guilds are linked to this Discord server yet.'
    }
  }

  const accessibleGuildsUpper = accessibleGuilds.map((g) =>
    g.trim().toUpperCase()
  )
  const requestedGuildUpper = (requestedGuild || accessibleGuilds[0])
    .trim()
    .toUpperCase()
  const resolveGuildLabel = (upper: string): string => {
    const index = accessibleGuildsUpper.indexOf(upper)
    return index >= 0 ? accessibleGuilds[index] : upper
  }

  if (
    requestedGuildUpper !== 'ALL' &&
    !accessibleGuildsUpper.includes(requestedGuildUpper)
  ) {
    return {
      ok: false,
      message: `Access denied: You don't have access to the requested guild from this Discord server.`
    }
  }

  const season = requestedSeason ?? (await getCurrentSeason(supabase))
  const targetGuildsUpper =
    requestedGuildUpper === 'ALL'
      ? accessibleGuildsUpper
      : [requestedGuildUpper]
  const targetGuildLabels = targetGuildsUpper.map(resolveGuildLabel)

  if (targetGuildLabels.length === 0) {
    return {
      ok: false,
      message: 'No guilds selected for the request.'
    }
  }

  const { data: tokenData, error: tokenError } = await supabase
    .from('EOT_GR_data')
    .select('displayName, userId, Guild')
    .eq('Season', season)
    .eq('damageType', 'Battle')
    .in('Guild', targetGuildLabels)

  if (tokenError) {
    return {
      ok: false,
      message: `Failed to load token usage data: ${tokenError.message}`
    }
  }

  let bombData: Array<{
    player_id: string
    guild: string
    last_used: string | null
  }> = []
  try {
    const { data } = await supabase
      .from('bomb_tracking')
      .select('player_id, guild, last_used')
      .in('guild', targetGuildLabels)
    bombData = data ?? []
  } catch (error) {
    console.log('Bomb tracking data unavailable:', (error as Error).message)
  }

  const playerAggregates: Record<
    string,
    {
      rawDisplayName: string
      displayName: string
      normalizedName: string
      guildLabel: string
      normalizedGuild: string
      tokensUsed: number
    }
  > = {}

  tokenData?.forEach((record: any) => {
    const guildLabel = record.Guild || ''
    const normalizedGuild = guildLabel.trim().toUpperCase()
    if (!targetGuildsUpper.includes(normalizedGuild)) {
      return
    }
    const rawDisplayName = resolveDisplayNameWithMap(
      record.displayName,
      record.userId,
      context.playerNameMap
    )
    const normalizedName = rawDisplayName.trim().toUpperCase()
    const key = `${normalizedGuild}:${normalizedName}`

    if (!playerAggregates[key]) {
      playerAggregates[key] = {
        rawDisplayName,
        // Relabel for DISPLAY; raw/key stay available for matching.
        displayName: relabelForDisplay(rawDisplayName, context.labelMap),
        normalizedName,
        guildLabel,
        normalizedGuild,
        tokensUsed: 0
      }
    }

    playerAggregates[key].tokensUsed += 1
  })

  const bombLookup = new Map<string, string | null>()
  bombData.forEach((bomb) => {
    const guildLabel = bomb.guild || ''
    const normalizedGuild = guildLabel.trim().toUpperCase()
    if (!targetGuildsUpper.includes(normalizedGuild)) {
      return
    }
    const normalizedName = (bomb.player_id || 'Unknown').trim().toUpperCase()
    const key = `${normalizedGuild}:${normalizedName}`

    if (!playerAggregates[key]) {
      const rawDisplayName = resolveDisplayNameWithMap(
        bomb.player_id,
        null,
        context.playerNameMap
      )
      playerAggregates[key] = {
        rawDisplayName,
        // Relabel for DISPLAY; key/normalizedName stay raw.
        displayName: relabelForDisplay(rawDisplayName, context.labelMap),
        normalizedName,
        guildLabel,
        normalizedGuild,
        tokensUsed: 0
      }
    }

    bombLookup.set(key, bomb.last_used ?? null)
  })

  const guildSummaries: GuildAvailabilitySummary[] = targetGuildsUpper
    .map((normalizedGuild) => {
      const label = resolveGuildLabel(normalizedGuild)
      const members = Object.values(playerAggregates)
        .filter((player) => player.normalizedGuild === normalizedGuild)
        .map((player) => {
          const key = `${player.normalizedGuild}:${player.normalizedName}`
          const tokensUsed = player.tokensUsed
          const tokensRemaining = Math.max(
            0,
            TOKENS_PER_SEASON_CAP - tokensUsed
          )
          const bombTimer = calculateBombTimer(bombLookup.get(key) ?? null)
          const bombReady = !bombTimer
          const bombStatus = bombReady ? 'Ready' : `Recharge in ${bombTimer}`

          return {
            rawDisplayName: player.rawDisplayName,
            displayName: player.displayName,
            tokensUsed,
            tokensRemaining,
            tokenCapacity: TOKENS_PER_SEASON_CAP,
            bombReady,
            bombStatus
          }
        })
        .sort((a, b) => {
          if (b.tokensRemaining !== a.tokensRemaining) {
            return b.tokensRemaining - a.tokensRemaining
          }
          if (a.bombReady !== b.bombReady) {
            return Number(b.bombReady) - Number(a.bombReady)
          }
          return a.displayName.localeCompare(b.displayName)
        })

      const totalTokensRemaining = members.reduce(
        (sum, member) => sum + member.tokensRemaining,
        0
      )
      const totalBombsReady = members.filter(
        (member) => member.bombReady
      ).length

      return {
        label,
        normalizedGuild,
        members,
        totalTokensRemaining,
        totalBombsReady
      }
    })
    .filter((summary) => summary.members.length > 0)

  if (guildSummaries.length === 0) {
    return {
      ok: false,
      message: `No season ${season} usage data found for the selected guild(s).`
    }
  }

  const totalPlayers = guildSummaries.reduce(
    (sum, guild) => sum + guild.members.length,
    0
  )
  const totalTokensAvailable = guildSummaries.reduce(
    (sum, guild) => sum + guild.totalTokensRemaining,
    0
  )
  const totalBombsReady = guildSummaries.reduce(
    (sum, guild) => sum + guild.totalBombsReady,
    0
  )

  return {
    ok: true,
    season,
    requestedGuildUpper,
    requestedGuildLabel:
      requestedGuildUpper === 'ALL'
        ? 'All Linked Guilds'
        : resolveGuildLabel(requestedGuildUpper),
    guilds: guildSummaries,
    totals: {
      players: totalPlayers,
      tokensReady: totalTokensAvailable,
      bombsReady: totalBombsReady
    }
  }
}

export {
  InteractionResponseType,
  formatCompactNumber,
  formatDurationShort,
  formatIntervalDuration,
  formatList,
  formatPercentage,
  formatRelativeDuration,
  formatGuildLabel,
  getGuildMapping,
  relabelForDisplay,
  verifyUserPermissions
}
