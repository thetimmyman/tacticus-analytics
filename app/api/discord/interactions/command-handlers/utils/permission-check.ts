import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.utils.permission-check'
)
import type { Supabase, CommandInteraction, CommandResponse } from '../types'
import {
  createCommandResponse,
  buildServerNotLinkedResponse,
  ERROR_THEME
} from './response-builder'
import { getOptionValue } from './option-parser'
import { resolveGuildContext } from './guild-resolution'
import {
  OFFICER_ONLY_COMMANDS,
  GUILD_SCOPED_COMMAND_SCOPES,
  UNLINKED_BOOTSTRAP_COMMANDS
} from '../../command-manifest'
import { resolveVerifiedDiscordIdentities } from '@/app/lib/auth/verified-player-authority'

/** Scoped commands check the role in the guild the command resolves; link management accepts any linked guild. */
export { OFFICER_ONLY_COMMANDS }

/** Returns null to ALLOW, so every path without positive officer standing must return a response. */
export async function checkOfficerPermission(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse | null> {
  const discordUserId =
    interaction.member?.user?.id || interaction.user?.id || null
  const discordGuildId = interaction.guild_id

  if (!discordGuildId) {
    return buildPermissionDeniedResponse(
      'This command can only be used inside a Discord server.'
    )
  }

  if (!discordUserId) {
    return buildPermissionDeniedResponse(
      'Unable to identify your Discord account.'
    )
  }

  try {
    const guildScopedResolutionScope =
      GUILD_SCOPED_COMMAND_SCOPES[interaction.data.name]
    let linkedGuildCodes: string[]

    if (guildScopedResolutionScope) {
      const requestedGuildOption = (
        getOptionValue(interaction.data.options, 'guild') as string | undefined
      )?.trim()
      const guildResolution = await resolveGuildContext(supabase, interaction, {
        requestedGuildOption,
        scope: guildScopedResolutionScope
      })

      if (!guildResolution.ok) {
        return guildResolution.response
      }

      linkedGuildCodes = guildResolution.guild.guildCode
        ? [guildResolution.guild.guildCode]
        : []
    } else {
      const { data: serverGuilds, error: sgError } = await supabase
        .from('discord_server_guilds')
        .select('game_guild_code')
        .eq('discord_guild_id', discordGuildId)
        .eq('is_active', true)

      if (sgError) {
        logger.error(
          { error: sgError.message },
          'Permission check: failed to load linked guilds'
        )
        return buildPermissionDeniedResponse(
          'Unable to verify officer permissions right now. Please try again later.'
        )
      }

      linkedGuildCodes = (serverGuilds ?? [])
        .map((row) => row.game_guild_code)
        .filter((code): code is string => code !== null)
    }

    if (linkedGuildCodes.length === 0) {
      // Zero links means the check was skipped, not passed: deny. /link and /link-cluster are exempt
      // (invite-code auth inside the handler).
      if (UNLINKED_BOOTSTRAP_COMMANDS.has(interaction.data.name)) {
        return null
      }
      return buildServerNotLinkedResponse()
    }

    // Stored player_mapping Discord IDs are never sufficient authority on their own.
    const playerRows = await resolveVerifiedDiscordIdentities(supabase, [
      discordUserId
    ])
    const isVerifiedOfficer = playerRows.some(
      (row) =>
        row.guildCode !== null &&
        linkedGuildCodes.includes(row.guildCode) &&
        (row.role?.toLowerCase() === 'officer' ||
          row.role?.toLowerCase() === 'leader')
    )

    if (isVerifiedOfficer) {
      return null
    }

    // Ranks sync ~6h, so tell "not an officer" from "no synced officer rows yet".
    const { data: anyOfficerRows, error: coverageError } = await supabase
      .from('player_mapping')
      .select('player_id')
      .eq('is_current', true)
      .in('guild_code', linkedGuildCodes)
      .in('role', ['officer', 'Officer', 'leader', 'Leader'])
      .limit(1)

    if (!coverageError && (anyOfficerRows ?? []).length === 0) {
      return buildPermissionDeniedResponse(
        'This command is restricted to **officers** and **leaders**, but no ' +
          'officer or leader roles are on record for this guild yet.\n\n' +
          'Guild ranks sync from the game roughly every **6 hours** — if the ' +
          'guild was just linked or you were just promoted, try again after ' +
          'the next sync. Ranks come from the in-game roster automatically.'
      )
    }

    return buildPermissionDeniedResponse(
      'This command is restricted to **officers** and **leaders**.\n\n' +
        'If you believe this is an error, link your player profile with a fresh single-use invite on the website, connect Discord in Profile, and confirm that your in-game guild role is officer or leader.'
    )
  } catch (error) {
    logger.error({ error }, 'Permission check threw unexpectedly')
    return buildPermissionDeniedResponse(
      'Unable to verify officer permissions right now. Please try again later.'
    )
  }
}

function buildPermissionDeniedResponse(message: string): CommandResponse {
  return createCommandResponse(ERROR_THEME, {
    title: 'Permission Denied',
    description: message
  })
}
