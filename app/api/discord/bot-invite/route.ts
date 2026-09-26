import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord.bot-invite')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { checkRateLimit, getClientId } from '@/app/lib/middleware/rate-limit'

const BOT_INVITE_ENDPOINT = '/api/discord/bot-invite'
const MAX_BOT_INVITE_BODY_BYTES = 8 * 1024
const DISCORD_SNOWFLAKE = /^\d{17,20}$/

async function readBotInviteBody(
  request: NextRequest
): Promise<Record<string, unknown>> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_BOT_INVITE_BODY_BYTES
    ) {
      throw Errors.fromResponse(413, { error: 'Request body is too large' })
    }
  }

  if (!request.body) return {}
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_BOT_INVITE_BODY_BYTES) {
        await reader.cancel('Bot invite body exceeds the byte limit')
        throw Errors.fromResponse(413, { error: 'Request body is too large' })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  try {
    const parsed = JSON.parse(
      Buffer.concat(
        chunks.map((chunk) =>
          Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        ),
        totalBytes
      ).toString('utf8')
    ) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Body must be an object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    rethrowIfAppError(error)
    throw Errors.fromResponse(400, { error: 'Invalid JSON body' })
  }
}

type InviteConsumptionResult = {
  status?: string
  guild_code?: string
}

type BotInviteRpcClient = {
  rpc(
    name: 'consume_discord_bot_invite',
    args: {
      p_invite_code: string
      p_discord_guild_id: string
      p_discord_user_id: string | null
    }
  ): PromiseLike<{
    data: InviteConsumptionResult | null
    error: { message?: string | null } | null
  }>
}

const hashInviteCode = (inviteCode: string): string =>
  createHash('sha256').update(inviteCode).digest('hex').slice(0, 24)

const enforceBotInviteRateLimit = async (
  request: NextRequest,
  inviteCode: string
): Promise<void> => {
  // x-forwarded-for is client-controlled.
  const keys = [getClientId(request), `invite:${hashInviteCode(inviteCode)}`]

  for (const key of keys) {
    const result = await checkRateLimit(key, BOT_INVITE_ENDPOINT)
    if (result.allowed) continue

    const retryAfter = Math.max(
      1,
      Math.ceil((result.resetTime - Date.now()) / 1000)
    )
    request.rateLimitHeaders = {
      ...result.headers,
      'Retry-After': retryAfter.toString()
    }
    throw Errors.rateLimit(retryAfter)
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    // Deliberately unauthenticated (Discord triggers it): the guild_invite_code token is the auth.
    const body = await readBotInviteBody(request)

    const { searchParams } = new URL(request.url)
    const inviteCode = searchParams.get('guild_invite_code')
    const discordGuildId = body.guild_id
    const user =
      body.user && typeof body.user === 'object' && !Array.isArray(body.user)
        ? (body.user as Record<string, unknown>)
        : null
    const discordUserId = user?.id

    if (
      !inviteCode ||
      inviteCode.length > 128 ||
      typeof discordGuildId !== 'string' ||
      !DISCORD_SNOWFLAKE.test(discordGuildId) ||
      (discordUserId !== undefined &&
        (typeof discordUserId !== 'string' ||
          !DISCORD_SNOWFLAKE.test(discordUserId)))
    ) {
      throw Errors.fromResponse(400, {
        error: 'Missing invite code or guild ID'
      })
    }

    await enforceBotInviteRateLimit(request, inviteCode)

    const supabase = serviceDb()

    // One row lock covers validation and consumption, so a token cannot be double-spent.

    const inviteRpc = supabase as unknown as BotInviteRpcClient
    const { data: consumption, error: consumptionError } = await inviteRpc.rpc(
      'consume_discord_bot_invite',
      {
        p_invite_code: inviteCode,
        p_discord_guild_id: discordGuildId,
        p_discord_user_id:
          typeof discordUserId === 'string' ? discordUserId : null
      }
    )

    if (consumptionError) {
      logger.error(
        { error: consumptionError },
        'Atomic bot-invite consumption failed'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to link Discord server'
      })
    }

    if (!consumption || consumption.status === 'invalid') {
      throw Errors.fromResponse(404, {
        error: 'Invalid or expired invite code'
      })
    }

    if (consumption.status === 'exhausted') {
      throw Errors.fromResponse(410, {
        error: 'Invite code has reached maximum uses'
      })
    }

    if (consumption.status === 'expired') {
      throw Errors.fromResponse(410, { error: 'Invite code has expired' })
    }

    if (consumption.status === 'already_used') {
      throw Errors.fromResponse(410, {
        error: 'Invite code has already been used'
      })
    }

    if (consumption.status === 'guild_missing') {
      throw Errors.fromResponse(404, {
        error: 'Guild configuration not found for invite'
      })
    }

    if (!['linked', 'already_linked'].includes(consumption.status || '')) {
      logger.error(
        { status: consumption.status },
        'Atomic bot-invite consumption returned an unknown status'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to link Discord server'
      })
    }

    const guildCode = consumption.guild_code || ''
    const alreadyLinked = consumption.status === 'already_linked'

    return NextResponse.json({
      success: true,
      message: alreadyLinked
        ? `Discord server already linked to guild ${guildCode}`
        : `Discord server successfully linked to guild ${guildCode}`,
      guild_code: guildCode
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Bot invite webhook error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})
