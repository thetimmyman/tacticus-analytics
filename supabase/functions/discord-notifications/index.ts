import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import {
  createDeferredResponse,
  createPongResponse,
  InteractionType,
  verifyDiscordRequest
} from '../_shared/discord-auth.ts'
import {
  getDiscordCommandHandler,
  sendFollowupMessage
} from './command-handlers.ts'
import { createDiscordCommandContext } from './command-context.ts'

const DISCORD_PUBLIC_KEY =
  '9be90ced4b0c257eb5ef9acd706b9f00cd3723946dfd005d2785be4e3cd12895'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  const { isValid, body } = await verifyDiscordRequest(req, DISCORD_PUBLIC_KEY)
  if (!isValid) {
    return new Response('Invalid request', { status: 401 })
  }
  if (body.type === InteractionType.PING) {
    return createPongResponse()
  }
  if (body.type === InteractionType.APPLICATION_COMMAND) {
    setTimeout(async () => {
      const supabase = createServiceClient()
      try {
        const context = await createDiscordCommandContext(supabase)
        const handler = getDiscordCommandHandler(body.data.name)
        if (handler) {
          await handler(context, body)
        } else {
          await sendFollowupMessage(body.token, {
            content: 'Unknown command. Use /help to see available commands.',
            flags: 64
          })
        }
      } catch (error) {
        logger.error('Error handling command:', error)
        try {
          await sendFollowupMessage(body.token, {
            content: 'An error occurred while processing your command.',
            flags: 64
          })
        } catch (followupError) {
          logger.error(
            'Error sending command failure follow-up:',
            followupError
          )
        }
      }
    }, 0)
    return createDeferredResponse()
  }
  return new Response('Invalid interaction type', { status: 400 })
})
