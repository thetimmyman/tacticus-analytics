'use client'

import { useCallback, useEffect, useState } from 'react'

import { getErrorMessage } from './error-helpers'
import { createEmptyStatus, formatInterval, logger } from './parse'
import type { ExportStatusType, PlayerAvailability, StatusState } from './types'

type AvailabilityFilter = 'full' | 'capped' | 'bombs'

interface UseAvailabilityExportOptions {
  guildCode: string
  season: string
  players: PlayerAvailability[]
  totalTokensAvailable: number
  totalBombsAvailable: number
  cappedPlayers: number
  useMentions: boolean
}

interface DiscordIdentityMaps {
  usernames: Record<string, string>
  userIds: Record<string, string>
}

export function buildDiscordIdentityMaps(
  members: Array<{
    display_name: string
    discord_username?: string
    discord_user_id?: string
  }>
): DiscordIdentityMaps {
  const usernames: Record<string, string> = {}
  const userIds: Record<string, string> = {}

  members.forEach((member) => {
    if (member.discord_user_id) {
      userIds[member.display_name] = member.discord_user_id
    }

    const discordName = member.discord_username
    usernames[member.display_name] =
      discordName && !/^\d+$/.test(discordName) && !discordName.includes('@')
        ? discordName
        : member.display_name
  })

  return { usernames, userIds }
}

export function buildAvailabilityDiscordText({
  season,
  players,
  totalTokensAvailable,
  totalBombsAvailable,
  cappedPlayers,
  filterType,
  useMentions,
  discordUsernames,
  discordUserIds
}: Omit<UseAvailabilityExportOptions, 'guildCode'> & {
  filterType: AvailabilityFilter
  discordUsernames: Record<string, string>
  discordUserIds: Record<string, string>
}): string {
  let filteredPlayers = [...players]
  let titleSuffix = ''

  if (filterType === 'capped') {
    filteredPlayers = players.filter((player) => player.tokens_available >= 3)
    titleSuffix = ' - Capped Players'
  } else if (filterType === 'bombs') {
    filteredPlayers = players.filter((player) => player.bombs_available > 0)
    titleSuffix = ' - Bombs Available'
  }

  const resolveName = (name?: string, forMention = false) => {
    if (!name) return 'Unknown'
    if (forMention && useMentions && discordUserIds[name]) {
      return `<@${discordUserIds[name]}>`
    }
    return discordUsernames[name] || name
  }

  const lines = [`**GR Availability - S${season}${titleSuffix}**`]
  if (filterType !== 'full') {
    if (filteredPlayers.length === 0) {
      lines.push('None')
    } else {
      const names = filteredPlayers
        .map((player) => resolveName(player.display_name, true))
        .join(', ')
      lines.push(
        `${filteredPlayers.length} player${filteredPlayers.length !== 1 ? 's' : ''}: ${names}`
      )
    }
    return lines.join('\n')
  }

  lines.push(
    `Tokens: ${totalTokensAvailable} | Bombs: ${totalBombsAvailable} | Capped: ${cappedPlayers}/${players.length}`,
    '```',
    'Player         T  Next   B Btl',
    '----------------------------'
  )

  filteredPlayers.forEach((player) => {
    const playerName = resolveName(player.display_name)
      .substring(0, 14)
      .padEnd(14, ' ')
    let nextToken = '     '
    if (player.tokens_available < 3) {
      const time =
        player.token_cooldown ||
        formatInterval(
          typeof player.time_to_next_token === 'number'
            ? player.time_to_next_token
            : null
        ) ||
        '--'
      // "1h5m", "145m" or "11h43".
      nextToken = time
        .replace(/\s/g, '')
        .replace('0h', '')
        .replace('0m', '')
        .substring(0, 5)
        .padEnd(6, ' ')
    }
    const bomb = player.bombs_available > 0 ? 'Y' : 'N'
    const battles = String(player.battles_with_damage).padStart(3, ' ')
    lines.push(
      `${playerName} ${player.tokens_available}  ${nextToken} ${bomb} ${battles}`
    )
  })
  lines.push('```')
  return lines.join('\n')
}

export function useAvailabilityExport(options: UseAvailabilityExportOptions) {
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] =
    useState<StatusState<ExportStatusType>>(
      createEmptyStatus<ExportStatusType>()
    )
  const [discordIdentities, setDiscordIdentities] =
    useState<DiscordIdentityMaps>({ usernames: {}, userIds: {} })

  useEffect(() => {
    if (!options.guildCode) return
    let active = true

    const loadDiscordIdentities = async () => {
      try {
        const response = await fetch(
          `/api/discord/verified-members?guild_code=${encodeURIComponent(options.guildCode)}`,
          { method: 'GET', headers: { Accept: 'application/json' } }
        )
        const payload = (await response.json()) as {
          members?: Array<{
            display_name: string
            discord_username?: string
            discord_user_id?: string
          }>
        }
        if (!response.ok) {
          logger.error(
            { status: response.status },
            '[GRAvailability] Failed to fetch verified Discord members:'
          )
          return
        }
        if (active) {
          setDiscordIdentities(buildDiscordIdentityMaps(payload.members ?? []))
        }
      } catch (error) {
        logger.error({ err: error }, 'Error fetching Discord usernames:')
      }
    }

    void loadDiscordIdentities()
    return () => {
      active = false
    }
  }, [options.guildCode])

  const exportToDiscord = useCallback(
    async (postToWebhook = false, filterType: AvailabilityFilter = 'full') => {
      if (!options.guildCode) {
        setExportStatus({
          type: 'error',
          message: 'Guild code is missing. Unable to export availability.'
        })
        setTimeout(() => setExportStatus(createEmptyStatus()), 5000)
        return
      }

      setExporting(true)
      setExportStatus(createEmptyStatus())
      try {
        const content = buildAvailabilityDiscordText({
          ...options,
          filterType,
          discordUsernames: discordIdentities.usernames,
          discordUserIds: discordIdentities.userIds
        })

        if (!postToWebhook) {
          await navigator.clipboard.writeText(content)
          setExportStatus({ type: 'success', message: 'Copied to clipboard!' })
        } else {
          let response: Response
          try {
            response = await fetch('/api/discord-webhooks/post-availability', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ guild: options.guildCode, content })
            })
          } catch {
            throw new Error(
              'Network error. Please check your connection and try again.'
            )
          }

          const contentType = response.headers.get('content-type')
          if (contentType?.includes('application/json')) {
            const data = await response.json()
            if (!response.ok) {
              throw new Error(
                getErrorMessage(data, 'Failed to post to Discord')
              )
            }
            setExportStatus({ type: 'success', message: 'Posted to Discord!' })
          } else {
            // Non-JSON (likely an HTML auth redirect).
            const text = await response.text()
            if (text.includes('<!DOCTYPE') || text.includes('<html')) {
              throw new Error(
                'Authentication required. Please log out and log back in.'
              )
            }
            throw new Error('Failed to post to Discord. Please try again.')
          }
        }
        setTimeout(() => setExportStatus(createEmptyStatus()), 3000)
      } catch (error) {
        logger.error({ err: error }, 'Export error:')
        const message = error instanceof Error ? error.message : 'Export failed'
        setExportStatus({
          type: 'error',
          message:
            message.includes('<!DOCTYPE') ||
            message.includes('<html') ||
            message.includes('Authentication required')
              ? 'Authentication required. Please log out and log back in.'
              : message
        })
        setTimeout(() => setExportStatus(createEmptyStatus()), 5000)
      } finally {
        setExporting(false)
      }
    },
    [discordIdentities, options]
  )

  return { exporting, exportStatus, exportToDiscord }
}
