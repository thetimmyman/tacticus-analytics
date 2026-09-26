import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.test-api-key')
import {
  sanitizeErrorForLog,
  maskSensitive
} from '@tacticus/app-core/logging-sanitizer'
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  detectSeason,
  extractGuildInfo,
  fetchGuildProbeWithRetry,
  getErrorMessage,
  getErrorName,
  isTimeoutError,
  type MembersInfo,
  type ParsedGuildInfo,
  type RaidInfo
} from '@/app/lib/api/guild-probe-client'
import {
  getFirstBooleanValue,
  getFirstStringArray,
  getFirstStringValue,
  getNumberFromRecord,
  getRecordsArrayFromPaths,
  getStringFromRecord,
  toRecord
} from '@/app/lib/utils/coerce'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: false,
    skipSecurityChecks: true
  })
  if (securityResult) return securityResult

  const startTime = Date.now()

  try {
    // Deliberately unauthenticated: onboarding tests a key before a session exists. No DB writes.
    let body: unknown
    try {
      body = await request.json()
    } catch (parseError) {
      logger.error(
        { err: sanitizeErrorForLog(parseError) },
        '[TEST-API-KEY] Failed to parse request body:'
      )
      throw Errors.fromResponse(400, {
        error: 'Invalid request format',
        details: 'Request body must be valid JSON',
        success: false
      })
    }

    if (!body || typeof body !== 'object') {
      throw Errors.fromResponse(400, {
        error: 'Invalid request format',
        details: 'Request body must be an object containing api_key',
        success: false
      })
    }

    const apiKeyValue = (body as { api_key?: unknown }).api_key

    logger.debug(
      { data: apiKeyValue ? '[REDACTED]' : 'No API key provided' },
      '[TEST-API-KEY] Testing API key:'
    )

    if (!apiKeyValue) {
      throw Errors.fromResponse(400, {
        error: 'Missing api_key',
        details: 'API key is required for validation',
        success: false
      })
    }

    if (typeof apiKeyValue !== 'string') {
      throw Errors.fromResponse(400, {
        error: 'Invalid api_key format',
        details: 'API key must be a string',
        success: false
      })
    }

    if (apiKeyValue.length < 20 || apiKeyValue.length > 100) {
      throw Errors.fromResponse(400, {
        error: 'Invalid api_key length',
        details:
          'API key appears to be malformed. Please check you copied the entire key.',
        success: false
      })
    }

    const apiKey = apiKeyValue

    const metrics = {
      apiKeyValid: false,
      canAccessGuildData: false,
      canAccessRaidData: false,
      canAccessMembers: false,
      isLeaderKey: false,
      guildIdFound: false,
      seasonDetected: false,
      timeElapsed: 0
    }

    logger.debug('[TEST-API-KEY] Test 1: Checking /guild endpoint...')
    let guildInfo: ParsedGuildInfo | null = null
    let guildError: string | null = null
    let guildProbeTimedOut = false

    try {
      const guildResponse = await fetchGuildProbeWithRetry(
        `${TACTICUS_API.BASE_URL}/guild`,
        {
          headers: {
            'X-API-KEY': apiKey,
            Accept: 'application/json'
          }
        }
      )

      const guildStatus = guildResponse.status
      metrics.apiKeyValid = guildStatus !== 401

      if (guildResponse.ok) {
        const guildData: unknown = await guildResponse.json()
        guildInfo = extractGuildInfo(guildData)
        metrics.canAccessGuildData = true
        metrics.guildIdFound = Boolean(guildInfo.guildId)

        const userRole = getFirstStringValue(guildData, [
          ['user', 'role'],
          ['member', 'role'],
          ['role'],
          ['playerRole'],
          ['body', 'user', 'role'],
          ['body', 'member', 'role']
        ])

        const permissions = getFirstStringArray(guildData, [['permissions']])
        const hasLeaderPermissions =
          permissions.some(
            (permission) => permission.toLowerCase() === 'manage_guild'
          ) ||
          getFirstBooleanValue(guildData, [
            ['canManageGuild'],
            ['isGuildLeader']
          ]) === true

        metrics.isLeaderKey =
          (userRole !== null && userRole.toLowerCase() === 'leader') ||
          hasLeaderPermissions

        const guildDataRecord = toRecord(guildData)
        const guildBodyRecord = toRecord(guildDataRecord?.body)
        const userRecord =
          toRecord(guildDataRecord?.user) ?? toRecord(guildBodyRecord?.user)
        const memberRecord =
          toRecord(guildDataRecord?.member) ?? toRecord(guildBodyRecord?.member)

        logger.info(
          {
            guildId: guildInfo.guildId,
            guildName: guildInfo.guildName,
            guildCode: guildInfo.guildCode,
            userRole,
            hasLeaderPermissions,
            isLeaderKey: metrics.isLeaderKey,
            rawDataKeys: guildDataRecord ? Object.keys(guildDataRecord) : [],
            availableUserFields: userRecord
              ? Object.keys(userRecord)
              : memberRecord
                ? Object.keys(memberRecord)
                : []
          },
          '[TEST-API-KEY] Guild data extracted:'
        )
      } else {
        let errorText = ''
        try {
          errorText = await guildResponse.text()
        } catch {
          errorText = 'Unable to read error response'
        }

        if (guildStatus === 401) {
          guildError = 'Authentication failed - API key is invalid or expired'
        } else if (guildStatus === 403) {
          guildError = 'Access denied - API key lacks necessary permissions'
        } else if (guildStatus === 404) {
          guildError =
            'Guild not found - API key may not be associated with a guild'
        } else if (guildStatus === 429) {
          guildError =
            'Rate limit exceeded - too many requests, please wait and try again'
        } else if (guildStatus >= 500) {
          guildError = `Tacticus API server error (${guildStatus}) - please try again later`
        } else {
          guildError = `HTTP ${guildStatus}: ${maskSensitive(errorText)}`
        }
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error)
      const lowerMessage = errorMessage.toLowerCase()
      if (isTimeoutError(error)) {
        guildProbeTimedOut = true
        guildError =
          'Request timed out - Tacticus API may be slow or unavailable'
      } else if (
        lowerMessage.includes('fetch') ||
        lowerMessage.includes('network')
      ) {
        guildError = 'Network error - unable to connect to Tacticus API'
      } else {
        guildError = `Connection failed: ${maskSensitive(errorMessage || 'An unknown error occurred')}`
      }
      logger.error(
        { err: sanitizeErrorForLog(error) },
        '[TEST-API-KEY] Guild endpoint failed:'
      )
    }

    logger.debug('[TEST-API-KEY] Test 2: Checking /guildRaid endpoint...')
    let raidInfo: RaidInfo | null = null
    let raidError: string | null = null
    let detectedSeason: string | null = null

    if (guildProbeTimedOut) {
      raidError = 'Skipped because the guild endpoint timed out'
    } else {
      try {
        const grResponse = await fetchGuildProbeWithRetry(
          `${TACTICUS_API.BASE_URL}/guildRaid`,
          {
            headers: {
              'X-API-KEY': apiKey,
              Accept: 'application/json'
            }
          }
        )

        if (grResponse.ok) {
          const grData: unknown = await grResponse.json()
          metrics.canAccessRaidData = true

          detectedSeason = detectSeason(grData)
          metrics.seasonDetected = !!detectedSeason

          const entries = getRecordsArrayFromPaths(grData, [
            ['entries'],
            ['body', 'entries']
          ])
          raidInfo = {
            hasData: entries.length > 0,
            entryCount: entries.length,
            season: detectedSeason,
            bossTypes: Array.from(
              new Set(
                entries
                  .map((entry) => getStringFromRecord(entry, 'type'))
                  .filter((value): value is string => Boolean(value))
              )
            ).slice(0, 5),
            hasPrimeBosses: entries.some((entry) => {
              const encounterIndex = getNumberFromRecord(
                entry,
                'encounterIndex'
              )
              return typeof encounterIndex === 'number' && encounterIndex > 0
            })
          }

          logger.info(
            { raidInfo: raidInfo },
            '[TEST-API-KEY] Raid data extracted:'
          )
        } else {
          const raidStatus = grResponse.status
          if (raidStatus === 401 || raidStatus === 403) {
            raidError = 'Access denied - API key cannot access raid data'
          } else if (raidStatus === 404) {
            raidError = 'No active raid - this is normal between raid seasons'
          } else if (raidStatus === 429) {
            raidError = 'Rate limit exceeded for raid endpoint'
          } else if (raidStatus >= 500) {
            raidError = `Tacticus API server error (${raidStatus})`
          } else {
            let errorText = ''
            try {
              errorText = await grResponse.text()
            } catch {
              errorText = 'Unable to read error response'
            }
            raidError = `HTTP ${raidStatus}: ${maskSensitive(errorText)}`
          }
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)
        const lowerMessage = errorMessage.toLowerCase()
        if (isTimeoutError(error)) {
          raidError = 'Raid endpoint timed out'
        } else if (
          lowerMessage.includes('fetch') ||
          lowerMessage.includes('network')
        ) {
          raidError = 'Network error accessing raid endpoint'
        } else {
          raidError = `Connection failed: ${maskSensitive(errorMessage || 'An unknown error occurred')}`
        }
        logger.error(
          { err: sanitizeErrorForLog(error) },
          '[TEST-API-KEY] GuildRaid endpoint failed:'
        )
      }
    }

    // Member data comes from LOKI, not Tacticus.
    logger.debug(
      '[TEST-API-KEY] Test 3: Checking /members endpoint (optional)...'
    )
    let membersInfo: MembersInfo | null = null
    let membersError: string | null = null

    if (guildInfo?.guildId) {
      try {
        const membersResponse = await fetchGuildProbeWithRetry(
          `${TACTICUS_API.BASE_URL}/guild/${guildInfo.guildId}/members`,
          {
            headers: {
              'X-API-KEY': apiKey,
              Accept: 'application/json'
            }
          }
        )

        if (membersResponse.ok) {
          const membersData: unknown = await membersResponse.json()
          const members = getRecordsArrayFromPaths(membersData, [
            ['members'],
            ['guildMembers']
          ])
          metrics.canAccessMembers = members.length > 0

          const currentUser = members.find((member) => {
            const flags = ['isCurrentUser', 'isMe', 'isSelf', 'currentUser']
            return flags.some((flag) => member[flag] === true)
          })

          const currentUserRole = currentUser
            ? getFirstStringValue(currentUser, [['role'], ['playerRole']])
            : null

          membersInfo = {
            memberCount: members.length,
            hasMembers: members.length > 0,
            currentUserRole
          }

          if (membersInfo.currentUserRole) {
            const roleStr = String(membersInfo.currentUserRole).toLowerCase()
            metrics.isLeaderKey = metrics.isLeaderKey || roleStr === 'leader'
          }

          // Only leader keys see these member fields.
          if (!metrics.isLeaderKey && members.length > 0) {
            const hasSensitiveData = members.some((member) =>
              ['lastActive', 'lastLogin', 'apiKey', 'email'].some(
                (field) => typeof member[field] !== 'undefined'
              )
            )
            if (hasSensitiveData) {
              metrics.isLeaderKey = true
              logger.info(
                '[TEST-API-KEY] Detected leader key based on sensitive member data access'
              )
            }
          }

          logger.info(
            { membersInfo: membersInfo },
            '[TEST-API-KEY] Members data extracted:'
          )
        } else {
          const membersStatus = membersResponse.status
          if (membersStatus === 401 || membersStatus === 403) {
            membersError =
              'Access denied - API key cannot access member list (may be a personal key)'
          } else if (membersStatus === 404) {
            membersError = 'Guild or members not found'
          } else if (membersStatus === 429) {
            membersError = 'Rate limit exceeded for members endpoint'
          } else if (membersStatus >= 500) {
            membersError = `Tacticus API server error (${membersStatus})`
          } else {
            membersError = `HTTP ${membersStatus}`
          }
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)
        const lowerMessage = errorMessage.toLowerCase()
        if (isTimeoutError(error)) {
          membersError = 'Members endpoint timed out'
        } else if (
          lowerMessage.includes('fetch') ||
          lowerMessage.includes('network')
        ) {
          membersError = 'Network error accessing members endpoint'
        } else {
          membersError = `Connection failed: ${maskSensitive(errorMessage || 'An unknown error occurred')}`
        }
        logger.error(
          { err: sanitizeErrorForLog(error) },
          '[TEST-API-KEY] Members endpoint failed:'
        )
      }
    }

    metrics.timeElapsed = Date.now() - startTime

    // Members come from LOKI, so they are not required.
    const success =
      metrics.apiKeyValid &&
      metrics.canAccessGuildData &&
      metrics.canAccessRaidData

    let recommendation =
      'Unknown issue - please check the detailed error messages'
    if (guildProbeTimedOut) {
      recommendation =
        'Tacticus API timed out while validating guild access. Please try again.'
    } else if (!metrics.apiKeyValid) {
      recommendation = 'Invalid API key - please check it is correct'
    } else if (metrics.canAccessGuildData && metrics.canAccessRaidData) {
      if (metrics.isLeaderKey) {
        recommendation =
          '✅ API key validated successfully! Detected as a leader key with full access.'
      } else {
        recommendation =
          '✅ API key validated successfully! Guild and raid data access confirmed.'
      }
      if (metrics.canAccessMembers) {
        recommendation += ' (Bonus: Can also access Tacticus member endpoint)'
      }
    } else if (metrics.canAccessGuildData && !metrics.canAccessRaidData) {
      recommendation =
        '⚠️ API key missing "Guild Raid" permission. The app will have limited functionality - cannot track battle data, boss encounters, or performance metrics. Please generate a new API key with both "Guild" and "Guild Raid" permissions selected.'
    } else if (!metrics.canAccessGuildData && metrics.canAccessRaidData) {
      recommendation =
        '⚠️ API key missing "Guild" permission. The app will have limited functionality - cannot access guild information or member lists. Please generate a new API key with both "Guild" and "Guild Raid" permissions selected.'
    } else if (!metrics.canAccessGuildData && !metrics.canAccessRaidData) {
      recommendation =
        '❌ Validation failed: API key missing both "Guild" and "Guild Raid" permissions. The app cannot function without these. Please generate a new API key from the Tacticus website with both permissions enabled.'
    } else if (metrics.apiKeyValid) {
      recommendation =
        '⚠️ API key appears valid but has unexpected permissions. Please ensure you\'ve selected both "Guild" and "Guild Raid" when generating the API key from the Tacticus website.'
    }

    return NextResponse.json({
      success,
      metrics,
      tests: {
        guild: {
          success: metrics.canAccessGuildData,
          data: guildInfo,
          error: guildError
        },
        guildRaid: {
          success: metrics.canAccessRaidData,
          data: raidInfo,
          error: raidError
        },
        members: {
          success: metrics.canAccessMembers,
          data: membersInfo,
          error: membersError
        }
      },
      autoDiscovered: {
        guildId: guildInfo?.guildId,
        guildName: guildInfo?.guildName,
        guildCode: guildInfo?.guildCode,
        season: detectedSeason,
        isLeaderKey: metrics.isLeaderKey
      },
      summary: {
        recommendation,
        processingTimeMs: metrics.timeElapsed
      }
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    logger.error(
      { err: sanitizeErrorForLog(error) },
      '[TEST-API-KEY] Unexpected error:'
    )

    let userMessage =
      'An unexpected error occurred while validating the API key'
    let statusCode = 500
    const errorMessage = getErrorMessage(error)
    const lowerMessage = errorMessage.toLowerCase()
    const errorName = getErrorName(error)

    if (errorName === 'AbortError') {
      userMessage = 'Request timed out - please try again'
      statusCode = 408
    } else if (
      lowerMessage.includes('network') ||
      lowerMessage.includes('fetch')
    ) {
      userMessage =
        'Network error - unable to connect to Tacticus API. Please check your connection and try again.'
      statusCode = 503
    } else if (lowerMessage.includes('json')) {
      userMessage = 'Invalid response format from Tacticus API'
      statusCode = 502
    }

    throw Errors.fromResponse(statusCode, {
      success: false,
      error: userMessage,
      details:
        process.env.NODE_ENV === 'development'
          ? maskSensitive(errorMessage)
          : undefined,
      stack:
        process.env.NODE_ENV === 'development' && error instanceof Error
          ? maskSensitive((error as Error).stack || '')
          : undefined,
      summary: {
        recommendation:
          'Validation failed due to an unexpected error. Please try again or contact support if the issue persists.',
        processingTimeMs: Date.now() - startTime
      }
    })
  }
})
