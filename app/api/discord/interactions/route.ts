import { NextRequest, NextResponse, after } from 'next/server'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  InteractionType,
  InteractionResponseType,
  type APIInteraction,
  type APIChatInputApplicationCommandInteraction,
  type APIApplicationCommandAutocompleteInteraction,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction
} from 'discord-api-types/v10'
import { verifyDiscordRequest } from '@/app/lib/utils/discord-verify'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { sendDiscordFollowupMessage } from '@/app/lib/discord/followup-message'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  handleBombsCommand,
  handleGuildStatsCommand,
  handleHelpCommand,
  handleLinkCommand,
  handleLinkClusterCommand,
  handleUnlinkCommand,
  handleSetDefaultGuildCommand,
  handleSetUserGuildCommand,
  handlePlayerStatsCommand,
  handlePlayerTimeCommand,
  handlePlayerTokensCommand,
  handleRaidStatusCommand,
  handleTokenReminderCommand,
  handleTokenOverviewCommand,
  handleTokenUsageCommand,
  handleTokensCommand,
  handleTimeToBurnCommand,
  handleStatusCommand,
  handlePlayerPerformanceCommand,
  getPlayerAutocompleteChoices,
  handleAskCommand,
  handlePlaybookCommand,
  getBossAutocompleteChoices,
  type CommandHandler
} from './command-handlers/index'
import {
  OFFICER_ONLY_COMMANDS,
  checkOfficerPermission
} from './command-handlers/utils/permission-check'
import { getOptionValue } from './command-handlers/utils/option-parser'
import { DEFERRED_COMMANDS, PUBLIC_OPTION_DEFAULTS } from './command-manifest'

const logger = createComponentLogger('api.discord.interactions')

const commandHandlers: Record<string, CommandHandler> = {
  help: async (supabase, interaction) => {
    void supabase
    logger.debug({ guildId: interaction.guild_id }, 'Help command invoked')
    return handleHelpCommand()
  },
  status: handleStatusCommand,
  link: handleLinkCommand,
  'link-cluster': handleLinkClusterCommand,
  unlink: handleUnlinkCommand,
  'set-default-guild': handleSetDefaultGuildCommand,
  'set-user-guild': handleSetUserGuildCommand,
  tokens: handleTokensCommand,
  bombs: handleBombsCommand,
  'token-usage': handleTokenUsageCommand,
  'token-overview': handleTokenOverviewCommand,
  'time-to-burn': handleTimeToBurnCommand,
  'player-tokens': handlePlayerTokensCommand,
  'player-time': handlePlayerTimeCommand,
  stats: handlePlayerStatsCommand,
  'raid-status': handleRaidStatusCommand,
  raid: handleRaidStatusCommand,
  'token-reminder': handleTokenReminderCommand,
  'guild-stats': handleGuildStatsCommand,
  boss: handleGuildStatsCommand,
  'player-stats': handlePlayerStatsCommand,
  'player-performance': handlePlayerPerformanceCommand,
  ask: handleAskCommand,
  playbook: handlePlaybookCommand
}

const EPHEMERAL_FLAG = 1 << 6
const PRIVATE_RESPONSE_AFTER_PUBLIC_DEFER_MESSAGE =
  'This response could not be shown publicly. Please rerun the command privately.'
const DB_FREE_COMMANDS: ReadonlySet<string> = new Set(['ask'])
const STATIC_BOSS_AUTOCOMPLETE_COMMANDS: ReadonlySet<string> = new Set([
  'playbook'
])

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const signature = request.headers.get('x-signature-ed25519')
    const timestamp = request.headers.get('x-signature-timestamp')

    if (signature && timestamp) {
      const isValid = await verifyDiscordRequest('', signature, timestamp)

      if (!isValid) {
        throw Errors.fromResponse(401, { error: 'Invalid request signature' })
      }
    }

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Discord interaction validation error:')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const signature = request.headers.get('x-signature-ed25519')
    const timestamp = request.headers.get('x-signature-timestamp')

    if (!signature || !timestamp) {
      throw Errors.fromResponse(401, { error: 'Missing signature headers' })
    }

    const rawBody = await request.text()
    const isValid = await verifyDiscordRequest(rawBody, signature, timestamp)

    if (!isValid) {
      throw Errors.fromResponse(401, { error: 'Invalid request signature' })
    }

    const interaction = JSON.parse(rawBody) as APIInteraction

    if (interaction.type === InteractionType.Ping) {
      return NextResponse.json({ type: InteractionResponseType.Pong })
    }

    if (interaction.type === InteractionType.ApplicationCommand) {
      return await handleApplicationCommand(
        interaction as APIChatInputApplicationCommandInteraction
      )
    }

    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
      return await handleAutocomplete(
        interaction as APIApplicationCommandAutocompleteInteraction
      )
    }

    // Modal submits share the components' namespaced custom_ids.
    if (
      interaction.type === InteractionType.MessageComponent ||
      interaction.type === InteractionType.ModalSubmit
    ) {
      return await handleComponentOrModal(
        interaction as
          APIMessageComponentInteraction | APIModalSubmitInteraction
      )
    }

    throw Errors.fromResponse(400, { error: 'Unsupported interaction type' })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Discord interaction error:')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})

function shouldDeferEphemerally(
  interaction: APIChatInputApplicationCommandInteraction
): boolean {
  const defaultPublic = PUBLIC_OPTION_DEFAULTS.get(interaction.data.name)
  if (defaultPublic !== undefined) {
    const publicOption = getOptionValue(interaction.data.options, 'public')
    return defaultPublic ? publicOption === false : publicOption !== true
  }
  // A public defer would force the other handlers' ephemeral responses into the placeholder.
  return true
}

async function handleApplicationCommand(
  interaction: APIChatInputApplicationCommandInteraction
) {
  const handler = commandHandlers[interaction.data.name]

  if (!handler) {
    return NextResponse.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: `Unknown command: ${interaction.data.name}`,
        flags: EPHEMERAL_FLAG
      }
    })
  }

  if (DB_FREE_COMMANDS.has(interaction.data.name)) {
    try {
      const responseData = await handler(
        undefined as unknown as Parameters<CommandHandler>[0],
        interaction
      )
      return NextResponse.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: responseData
      })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error(
        { err: error },
        `Error handling command ${interaction.data.name}:`
      )
      return NextResponse.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: 'Sorry, there was an error processing your command.',
          flags: EPHEMERAL_FLAG
        }
      })
    }
  }

  let supabase
  try {
    supabase = serviceDb()
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Failed to create Supabase client:')
    return NextResponse.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'Configuration error: Supabase credentials are missing.',
        flags: EPHEMERAL_FLAG
      }
    })
  }

  if (OFFICER_ONLY_COMMANDS.has(interaction.data.name)) {
    const denied = await checkOfficerPermission(supabase, interaction)
    if (denied) {
      return NextResponse.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: denied
      })
    }
  }

  if (DEFERRED_COMMANDS.has(interaction.data.name)) {
    const interactionToken = interaction.token
    const commandName = interaction.data.name
    const deferredEphemeral = shouldDeferEphemerally(interaction)

    after(async () => {
      try {
        logger.info(
          { guildId: interaction.guild_id },
          `Processing deferred command: ${commandName}`
        )
        const responseData = await handler(supabase, interaction)
        const responseIsEphemeral =
          typeof responseData.flags === 'number' &&
          (responseData.flags & EPHEMERAL_FLAG) !== 0
        await sendDiscordFollowupMessage(
          interactionToken,
          !deferredEphemeral && responseIsEphemeral
            ? { content: PRIVATE_RESPONSE_AFTER_PUBLIC_DEFER_MESSAGE }
            : responseData
        )
        logger.info(`Deferred command completed: ${commandName}`)
      } catch (error) {
        logger.error(
          { err: error },
          `Error handling deferred command ${commandName}:`
        )
        await sendDiscordFollowupMessage(
          interactionToken,
          deferredEphemeral
            ? {
                content: 'Sorry, there was an error processing your command.',
                flags: EPHEMERAL_FLAG
              }
            : {
                content: 'Sorry, there was an error processing your command.'
              }
        )
      }
    })

    return NextResponse.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      ...(deferredEphemeral ? { data: { flags: EPHEMERAL_FLAG } } : {})
    })
  }

  try {
    const responseData = await handler(supabase, interaction)
    return NextResponse.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: responseData
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { err: error },
      `Error handling command ${interaction.data.name}:`
    )
    return NextResponse.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'Sorry, there was an error processing your command.',
        flags: EPHEMERAL_FLAG
      }
    })
  }
}

async function handleAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction
) {
  if (STATIC_BOSS_AUTOCOMPLETE_COMMANDS.has(interaction.data.name)) {
    try {
      return NextResponse.json({
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: { choices: getBossAutocompleteChoices(interaction) }
      })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ err: error }, 'Static autocomplete handler error:')
      return NextResponse.json({
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: { choices: [] }
      })
    }
  }

  let supabase
  try {
    supabase = serviceDb()
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { err: error },
      'Failed to create Supabase client for autocomplete:'
    )
    return NextResponse.json({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] }
    })
  }

  try {
    let choices: Array<{ name: string; value: string }> = []

    if (
      interaction.data.name === 'player-tokens' ||
      interaction.data.name === 'player-time' ||
      interaction.data.name === 'player-stats' ||
      interaction.data.name === 'stats' ||
      interaction.data.name === 'player-performance' ||
      interaction.data.name === 'time-to-burn'
    ) {
      choices = await getPlayerAutocompleteChoices(supabase, interaction)
    }

    return NextResponse.json({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Autocomplete handler error:')
    return NextResponse.json({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] }
    })
  }
}

async function handleComponentOrModal(
  _interaction: APIMessageComponentInteraction | APIModalSubmitInteraction
) {
  return NextResponse.json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content: 'This control is not recognized.', flags: EPHEMERAL_FLAG }
  })
}
