import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.validate-api-key')
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { sanitizeErrorForLog } from '@tacticus/app-core/logging-sanitizer'

export const POST = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    // Peek at the body to decide auth before consuming it.
    const clonedRequest = request.clone()
    let payload: { apiKey?: string; guildCode?: string }
    try {
      payload = await clonedRequest.json()
    } catch (error) {
      logger.error(
        { error: sanitizeErrorForLog(error) },
        'Invalid JSON in API key validation request'
      )
      throw Errors.validation('Invalid request format', {
        endpoint: '/api/validate-api-key'
      })
    }

    const { apiKey, guildCode } = payload

    // The guild-code path decrypts stored secrets, so it needs auth; the raw-key
    // path stays public (the caller already has the key).
    const requireAuth = !apiKey && !!guildCode
    const securityResult = await apiSecurityMiddleware(request, {
      requireAuth,
      skipRateLimit: false // Enable rate limiting to prevent brute force
    })

    if (securityResult) return securityResult

    let keyToValidate = apiKey

    if (!apiKey && guildCode) {
      const normalizedGuildCode = GuildConfigService.normalizeCode(guildCode)

      // Caller must be a member of the requested guild.
      const supabase = await db()
      const user = await requireSessionUser(supabase, () =>
        Errors.fromStatus(401, 'Authentication required')
      )
      const { data: mapping } = await supabase
        .from(CURRENT_USER_PLAYER_MAPPING)
        .select('guild_code')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .maybeSingle()

      if (
        !mapping ||
        !mapping.guild_code ||
        GuildConfigService.normalizeCode(mapping.guild_code) !==
          normalizedGuildCode
      ) {
        throw Errors.fromStatus(
          403,
          'You can only validate API keys for your own guild'
        )
      }

      // Encrypted keys are readable only via the service client.
      const serviceClient = serviceDb()
      const guildConfig = await GuildConfigService.getFullWithSecrets(
        serviceClient,
        normalizedGuildCode
      )

      if (!guildConfig) {
        throw Errors.notFound('Guild', 'Guild not found')
      }

      if (guildConfig.api_key_encrypted) {
        try {
          keyToValidate = await decryptApiKey(guildConfig.api_key_encrypted)
        } catch (error) {
          logger.error(
            { err: sanitizeErrorForLog(error) },
            'Failed to decrypt API key:'
          )
          throw Errors.internal(
            'Failed to decrypt API key - encryption key may be missing',
            {
              endpoint: '/api/validate-api-key',
              guild_code: normalizedGuildCode
            }
          )
        }
      } else {
        throw Errors.validation('No API key found for this guild', {
          endpoint: '/api/validate-api-key',
          guild_code: normalizedGuildCode
        })
      }
    }

    if (!keyToValidate) {
      throw Errors.validation('API key is required for validation', {
        endpoint: '/api/validate-api-key'
      })
    }

    const validationResult = await validateApiKeyWithTacticus(keyToValidate)

    if (validationResult.isValid) {
      return NextResponse.json({
        valid: true,
        message: 'API key is valid and working',
        details: {
          guildInfo: validationResult.guildInfo,
          permissions: {
            canAccessGuild: validationResult.canAccessGuild,
            canAccessRaidData: validationResult.canAccessRaidData
          }
        }
      })
    }

    // useGuildActions.ts expects 200 with valid: false to update the DB.
    return NextResponse.json(
      {
        valid: false,
        message: validationResult.error || 'API key validation failed',
        error: validationResult.error || 'API key validation failed',
        details: {
          status: validationResult.statusCode
        }
      },
      { status: 200 }
    )
  }
)
