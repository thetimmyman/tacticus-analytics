/** Error creation with version context, troubleshooting steps and display formatting. */

import versionInfoFile from '../../../version.json' with { type: 'json' }
import { legacyConsoleLogger as logger } from '@tacticus/app-core/logger'
import { addErrorAlert, addDatabaseAlert } from './daily-alert-summary'
import { applyMechanicusVoice, mechanicusReportLead } from './mechanicus-voice'

type VersionMetadata = {
  version?: string
}

export interface ErrorContext {
  userId?: string
  guildCode?: string
  clusterCode?: string
  userRole?: string
  action?: string
  component?: string
  version?: string
  timestamp?: string
  sessionId?: string
  userAgent?: string
  url?: string
  webhookUrl?: string
  webhookType?: string
  eventType?: string
  externalService?: string
  httpStatus?: number
  status?: number
  errorDetails?: string
  originalError?: string
}

export interface EnhancedError {
  code: string
  message: string
  category:
    'auth' | 'database' | 'api' | 'validation' | 'encryption' | 'ui' | 'network'
  severity: 'low' | 'medium' | 'high' | 'critical'
  context: ErrorContext
  originalError?: unknown
  stackTrace?: string
  troubleshooting?: string[]
}

export function getVersionInfo(): {
  version: string
  buildDate?: string
  gitCommit?: string
} {
  try {
    let version = process.env.npm_package_version

    if (!version) {
      const versionFromFile = (versionInfoFile as VersionMetadata)?.version
      version = versionFromFile || 'unknown'
    }

    return {
      version: version || 'unknown',
      buildDate: process.env.BUILD_DATE,
      gitCommit: process.env.GIT_COMMIT
    }
  } catch {
    return { version: 'unknown' }
  }
}

export function createEnhancedError(
  code: string,
  message: string,
  category: EnhancedError['category'],
  severity: EnhancedError['severity'],
  context: Partial<ErrorContext> = {},
  originalError?: unknown
): EnhancedError {
  const versionInfo = getVersionInfo()
  const originalErrorStack =
    originalError instanceof Error ? originalError.stack : undefined

  const enhancedError: EnhancedError = {
    code,
    message,
    category,
    severity,
    context: {
      ...context,
      version: versionInfo.version,
      timestamp: new Date().toISOString(),
      userAgent:
        typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined
    },
    originalError,
    stackTrace: originalErrorStack ?? new Error().stack,
    troubleshooting: getTroubleshootingSteps(code)
  }

  // createError also runs in the browser; redact user identifiers from the client
  // emission (devtools, screenshots). Server logs keep full context.
  const isBrowser = typeof window !== 'undefined'
  const logContext = isBrowser
    ? {
        ...enhancedError.context,
        userId: undefined,
        sessionId: undefined,
        guildCode: undefined,
        clusterCode: undefined,
        webhookUrl: undefined,
        // A reset-password URL carries the recovery token in its query; keep the path only.
        url: enhancedError.context.url
          ? enhancedError.context.url.split('?')[0]
          : enhancedError.context.url
      }
    : enhancedError.context
  logger.error(`Enhanced Error [${code}]:`, {
    message,
    category,
    severity,
    context: logContext,
    version: versionInfo.version
  })

  if (severity === 'critical') {
    const alertFn = category === 'database' ? addDatabaseAlert : addErrorAlert
    alertFn(code, message, 'critical', {
      category,
      version: versionInfo.version,
      userId: context.userId,
      guildCode: context.guildCode,
      component: context.component,
      action: context.action
    })
  }

  return enhancedError
}

function getTroubleshootingSteps(code: string): string[] {
  const troubleshootingMap: Record<string, string[]> = {
    NETWORK_INTERRUPTED: [
      'You have NOT been locked out',
      'If you were changing your password, try signing in with the new password before retrying',
      'Check your internet connection before trying again',
      'If you linked Discord or Google, sign in with those buttons instead',
      'If it keeps failing, report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) with the error code'
    ],
    LOGIN_INVALID_CREDENTIALS: [
      'Double-check email address and password',
      'Ensure caps lock is off',
      'Try using "Forgot Password" if needed',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if account is locked'
    ],
    ACCOUNT_BANNED: [
      'Contact an app administrator if you believe the suspension is a mistake'
    ],
    EMAIL_NOT_CONFIRMED: [
      'Check your email inbox for confirmation link',
      'Check spam/junk folder',
      'Try resending confirmation email',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for manual verification'
    ],
    SIGNUP_FAILED: [
      'Ensure all required fields are filled',
      'Verify Tacticus Player ID is valid',
      'Check if email is already registered',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for assistance'
    ],
    PLAYER_ID_INVALID: [
      'Verify Tacticus Player ID format is correct',
      'Check if player exists in the game database',
      'Ensure player is associated with an approved guild',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for player verification'
    ],

    API_KEY_SAVE_FAILED: [
      'Check if user is authenticated',
      'Verify database connection',
      'Check RLS policies for player_mapping table',
      'Validate encryption key is properly set',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if issue persists'
    ],
    DATA_FETCH_FAILED: [
      'Check internet connection',
      'Verify Supabase service status',
      'Try refreshing the page',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if data fails to load'
    ],
    GUILD_LOAD_FAILED: [
      'Check if guild is enabled and active',
      'Verify user has proper guild permissions',
      'Try refreshing the page',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for guild configuration issues'
    ],

    VALIDATION_ERROR: [
      'Check all required fields are filled correctly',
      'Verify data format matches requirements',
      'Review any validation messages shown',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if validation seems incorrect'
    ],
    WEBHOOK_URL_INVALID: [
      'Ensure Discord webhook URL starts with https://discord.com/api/webhooks/',
      'Verify webhook is active in Discord server',
      'Check webhook permissions in Discord',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for webhook configuration help'
    ],
    FORM_VALIDATION_FAILED: [
      'Review all required fields are completed',
      'Check field format requirements',
      'Clear browser cache if form behaves unexpectedly',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if validation seems incorrect'
    ],

    DISCORD_API_FAILED: [
      'Check Discord service status',
      'Verify webhook URL is still valid',
      'Test webhook in Discord server settings',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for Discord integration issues'
    ],
    WEBHOOK_TEST_FAILED: [
      'Verify webhook URL format is correct',
      'Check Discord channel permissions',
      'Ensure webhook is not rate limited',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for webhook troubleshooting'
    ],

    PERFORMANCE_CALCULATION_FAILED: [
      'Verify sufficient battle data exists',
      'Check if season data is complete',
      'Try refreshing calculation data',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for analysis issues'
    ],
    LEADERBOARD_LOAD_FAILED: [
      'Check if current season has battle data',
      'Verify guild/cluster has active members',
      'Try refreshing the page',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for leaderboard issues'
    ],

    ENCRYPTION_FAILED: [
      'Verify ENCRYPTION_KEY environment variable is set',
      'Check encryption key has sufficient complexity',
      'Validate input data is not empty',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for encryption issues'
    ],
    DATABASE_CONNECTION_FAILED: [
      'Check Supabase environment variables',
      'Verify network connectivity',
      'Check Supabase service status',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for database connectivity issues'
    ],

    PROFILE_UPDATE_FAILED: [
      'Verify all required fields are completed',
      'Check if display name is unique',
      'Ensure user has proper permissions',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for profile issues'
    ],
    PROFILE_VALIDATION_FAILED: [
      'Check URL format for social media links',
      'Ensure display name meets length requirements',
      'Verify Tacticus share URL format',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if validation seems incorrect'
    ],
    PLAYER_CLAIM_FAILED: [
      'Verify Player ID is entered correctly',
      'Ensure Player ID exists in the database',
      'Check if Player ID is already claimed',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for player linking assistance'
    ],
    PLAYER_VERIFICATION_FAILED: [
      'Double-check Player ID format and spelling',
      'Verify player exists in your guild roster',
      'Ensure player has recent battle activity',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for verification help'
    ],
    PASSWORD_MISMATCH: [
      'Ensure both password fields match exactly',
      'Check for extra spaces or hidden characters',
      'Retype passwords carefully',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if issue persists'
    ],
    PASSWORD_TOO_SHORT: [
      'Password must be at least 12 characters long',
      'Include a lowercase letter, an uppercase letter, and a number',
      'Choose a strong, unique password',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for password requirements'
    ],
    INVALID_RESET_LINK: [
      'Request a new password reset link',
      'Check if link has expired (links expire after 1 hour)',
      'Ensure you clicked the most recent reset link',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for password reset assistance'
    ],
    EMAIL_VERIFICATION_FAILED: [
      'Check your email inbox and spam folder',
      'Try requesting a new verification email',
      'Ensure email address is entered correctly',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for verification help'
    ],

    TOKEN_ASSIGNMENT_FAILED: [
      'Check if you have available tokens',
      'Verify assignment is within token limits',
      'Ensure you have proper permissions',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for token assignment issues'
    ],
    TOKEN_DATA_LOAD_FAILED: [
      'Check your internet connection',
      'Verify you have an active API key',
      'Try refreshing the page',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if data fails to load'
    ],
    ASSIGNMENT_STATS_FAILED: [
      'Verify guild has recent battle data',
      'Check if current season is active',
      'Try refreshing assignment data',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for statistics issues'
    ],
    AVAILABILITY_CHECK_FAILED: [
      'Ensure API key is properly configured',
      'Check if Tacticus API is accessible',
      'Verify guild data is synchronized',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for availability check issues'
    ],

    ONBOARDING_WIZARD_FAILED: [
      'Ensure all required fields are completed',
      'Verify API key format is correct',
      'Check if guild code is available',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for onboarding assistance'
    ],
    API_KEY_TEST_FAILED: [
      'Verify API key is copied correctly',
      'Check if API key has proper permissions',
      'Ensure API key is not expired',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for API key issues'
    ],

    SETTINGS_SAVE_FAILED: [
      'Check if you have proper permissions',
      'Verify all required fields are completed',
      'Try saving settings again',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for settings issues'
    ],
    SETTINGS_VALIDATION_FAILED: [
      'Review threshold values are within valid ranges',
      'Check webhook URL format',
      'Ensure all required settings are configured',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for validation help'
    ],
    WEBHOOK_CONFIG_FAILED: [
      'Verify Discord webhook URL is correct',
      'Check webhook permissions in Discord',
      'Test webhook in Discord server settings',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for webhook configuration'
    ],

    ADMIN_ACCESS_FAILED: [
      'Verify you have Super Admin permissions',
      'Check if admin session is still active',
      'Try logging out and back in',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) for admin access issues'
    ],
    ADMIN_PASSWORD_FAILED: [
      'Enter the correct Super Admin password',
      'Check for typos or caps lock',
      'Try entering password again',
      'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) if password is forgotten'
    ]
  }

  const defaultSteps = [
    'Check application logs for detailed error information',
    'Verify all required environment variables are set',
    'Review browser developer console for additional errors',
    'Clear browser cache and cookies',
    'Try refreshing the page or logging out and back in',
    'Report in Discord [#Bug Reports](https://discord.com/channels/1112021785064521818/1412916691637452712) with error code and version information'
  ]

  return troubleshootingMap[code] || defaultSteps
}

export const ErrorCodes = {
  AUTH_REQUIRED: { category: 'auth' as const, severity: 'medium' as const },
  AUTH_FAILED: { category: 'auth' as const, severity: 'high' as const },
  LOGIN_INVALID_CREDENTIALS: {
    category: 'auth' as const,
    severity: 'medium' as const
  },
  ACCOUNT_BANNED: {
    category: 'auth' as const,
    severity: 'medium' as const
  },
  EMAIL_NOT_CONFIRMED: {
    category: 'auth' as const,
    severity: 'medium' as const
  },
  SIGNUP_FAILED: { category: 'auth' as const, severity: 'high' as const },
  PASSWORD_RESET_FAILED: {
    category: 'auth' as const,
    severity: 'medium' as const
  },
  NETWORK_INTERRUPTED: {
    category: 'network' as const,
    severity: 'low' as const
  },
  PERMISSION_DENIED: { category: 'auth' as const, severity: 'medium' as const },
  ACCESS_DENIED: { category: 'auth' as const, severity: 'medium' as const },
  SESSION_EXPIRED: { category: 'auth' as const, severity: 'medium' as const },

  DATABASE_CONNECTION_FAILED: {
    category: 'database' as const,
    severity: 'critical' as const
  },
  DATABASE_QUERY_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  DATABASE_UPDATE_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  DATA_FETCH_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  DATA_SAVE_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },

  API_KEY_SAVE_FAILED: { category: 'api' as const, severity: 'high' as const },
  API_KEY_LOAD_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  API_KEY_INVALID: { category: 'api' as const, severity: 'medium' as const },
  API_VALIDATION_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  TACTICUS_API_ERROR: { category: 'api' as const, severity: 'medium' as const },

  VALIDATION_ERROR: {
    category: 'validation' as const,
    severity: 'medium' as const
  },
  FORM_VALIDATION_FAILED: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  PLAYER_ID_INVALID: {
    category: 'validation' as const,
    severity: 'medium' as const
  },
  PLAYER_ID_VALIDATION_FAILED: {
    category: 'validation' as const,
    severity: 'medium' as const
  },
  EMAIL_VALIDATION_FAILED: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  PASSWORD_VALIDATION_FAILED: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  WEBHOOK_URL_INVALID: {
    category: 'validation' as const,
    severity: 'medium' as const
  },

  GUILD_LOAD_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  GUILD_CONFIG_SAVE_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  MEMBER_MANAGEMENT_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },

  THEME_SAVE_FAILED: { category: 'ui' as const, severity: 'low' as const },
  THEME_LOAD_FAILED: { category: 'ui' as const, severity: 'low' as const },
  UI_COMPONENT_ERROR: { category: 'ui' as const, severity: 'low' as const },
  IMAGE_LOAD_FAILED: { category: 'ui' as const, severity: 'low' as const },

  WEBHOOK_SAVE_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  WEBHOOK_TEST_FAILED: {
    category: 'network' as const,
    severity: 'medium' as const
  },
  DISCORD_API_FAILED: {
    category: 'network' as const,
    severity: 'medium' as const
  },
  DISCORD_MESSAGE_FAILED: {
    category: 'network' as const,
    severity: 'medium' as const
  },

  ENCRYPTION_FAILED: {
    category: 'encryption' as const,
    severity: 'critical' as const
  },
  DECRYPTION_FAILED: {
    category: 'encryption' as const,
    severity: 'critical' as const
  },

  PERFORMANCE_CALCULATION_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  LEADERBOARD_LOAD_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  META_ANALYSIS_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  BOSS_DATA_LOAD_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  PLAYER_STATS_LOAD_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },

  NETWORK_ERROR: { category: 'network' as const, severity: 'medium' as const },
  EXTERNAL_SERVICE_ERROR: {
    category: 'network' as const,
    severity: 'medium' as const
  },
  CONNECTION_TIMEOUT: {
    category: 'network' as const,
    severity: 'medium' as const
  },

  INTERNAL_SERVER_ERROR: {
    category: 'api' as const,
    severity: 'critical' as const
  },
  SERVICE_UNAVAILABLE: { category: 'api' as const, severity: 'high' as const },

  FILE_UPLOAD_FAILED: { category: 'api' as const, severity: 'medium' as const },
  FILE_SIZE_EXCEEDED: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  FILE_TYPE_INVALID: {
    category: 'validation' as const,
    severity: 'low' as const
  },

  PROFILE_UPDATE_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  PROFILE_VALIDATION_FAILED: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  PROFILE_NOT_FOUND: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  DELETE_ACCOUNT_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  PLAYER_CLAIM_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  PLAYER_VERIFICATION_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  PASSWORD_MISMATCH: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  PASSWORD_TOO_SHORT: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  INVALID_RESET_LINK: {
    category: 'auth' as const,
    severity: 'medium' as const
  },
  EMAIL_VERIFICATION_FAILED: {
    category: 'auth' as const,
    severity: 'medium' as const
  },

  TOKEN_ASSIGNMENT_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  TOKEN_DATA_LOAD_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  ASSIGNMENT_STATS_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  AVAILABILITY_CHECK_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  ASSIGNMENT_CLEAR_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  UPCOMING_ASSIGNMENTS_EMPTY: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  UPCOMING_ASSIGNMENTS_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  NOTES_UPDATE_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  BOSS_PREFERENCES_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },

  ONBOARDING_WIZARD_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  ONBOARDING_API_KEY_INVALID: {
    category: 'validation' as const,
    severity: 'medium' as const
  },
  ONBOARDING_CONFIG_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  ONBOARDING_MIN_GUILDS: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  CLUSTER_CREATION_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  GUILD_CREATION_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  API_KEY_TEST_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },

  SETTINGS_SAVE_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  SETTINGS_VALIDATION_FAILED: {
    category: 'validation' as const,
    severity: 'low' as const
  },
  WEBHOOK_CONFIG_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  SERVICE_ROLE_MISSING: { category: 'api' as const, severity: 'high' as const },

  ADMIN_ACCESS_FAILED: { category: 'auth' as const, severity: 'high' as const },
  ADMIN_PASSWORD_FAILED: {
    category: 'auth' as const,
    severity: 'medium' as const
  },
  ADMIN_OPERATION_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },

  WEBHOOK_NOT_CONFIGURED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  WEBHOOK_LOAD_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  DISCORD_API_ERROR: {
    category: 'network' as const,
    severity: 'medium' as const
  },
  NOTIFICATION_SEND_FAILED: {
    category: 'network' as const,
    severity: 'medium' as const
  },
  INVALID_EVENT_TYPE: {
    category: 'validation' as const,
    severity: 'low' as const
  },

  HISTORICAL_DATA_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },
  STATS_FETCH_FAILED: {
    category: 'database' as const,
    severity: 'medium' as const
  },

  ACCOUNT_DELETE_FAILED: {
    category: 'database' as const,
    severity: 'high' as const
  },
  ACCOUNT_DELETE_VALIDATION: {
    category: 'validation' as const,
    severity: 'low' as const
  },

  EXPORT_STATUS_CHECK_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  },
  EXPORT_REQUEST_FAILED: {
    category: 'api' as const,
    severity: 'medium' as const
  }
} as const

export function createError(
  errorCode: keyof typeof ErrorCodes,
  message: string,
  context: Partial<ErrorContext> = {},
  originalError?: unknown
): EnhancedError {
  const errorConfig = ErrorCodes[errorCode]
  return createEnhancedError(
    errorCode,
    message,
    errorConfig.category,
    errorConfig.severity,
    context,
    originalError
  )
}

export function formatErrorForUser(error: EnhancedError): {
  message: string
  code: string
  version: string
  timestamp: string
  supportMessage: string
  displayMessage: string
  troubleshooting?: string[]
} {
  const supportUrl =
    'https://discord.com/channels/1112021785064521818/1412916691637452712'
  const supportMessage = `Report in Discord [#Bug Reports](${supportUrl}) for assistance`
  const version = error.context.version || 'unknown'

  // Hide the code/version/#Bug-Reports breadcrumb only for user-fixable categories; backend and
  // high/critical errors keep it. Severity alone is no proxy: many *_LOAD_FAILED are medium.
  const NON_ACTIONABLE_CODES = new Set([
    'PASSWORD_RESET_FAILED',
    'EMAIL_VERIFICATION_FAILED'
  ])
  const userActionable =
    error.severity !== 'high' &&
    error.severity !== 'critical' &&
    !NON_ACTIONABLE_CODES.has(error.code) &&
    (error.category === 'validation' ||
      error.category === 'ui' ||
      error.category === 'auth' ||
      error.category === 'network')
  // Themed voice decorates only; the literal text, the [#Bug Reports] link and code · version stay verbatim.
  const themedMessage = applyMechanicusVoice({
    message: error.message,
    code: error.code,
    category: error.category,
    severity: error.severity
  })
  const displayMessage = userActionable
    ? themedMessage
    : `${themedMessage}\n\n${error.code} · v${version} — ${mechanicusReportLead(error.severity)} [#Bug Reports](${supportUrl})`

  return {
    message: error.message,
    code: error.code,
    version,
    timestamp: error.context.timestamp || new Date().toISOString(),
    supportMessage,
    displayMessage,
    troubleshooting:
      error.severity === 'low' ? error.troubleshooting : undefined
  }
}
