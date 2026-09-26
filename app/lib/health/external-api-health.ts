import { addInfrastructureAlert } from '@tacticus/app-core/daily-alert-summary'
import { API_URLS } from '@tacticus/app-core/api-constants'

interface ExternalApiHealthResult {
  name: string
  reachable: boolean
  responseTimeMs: number
  statusCode?: number
  error?: string
}

interface AllApiHealthResults {
  tacticus: ExternalApiHealthResult
  discord: ExternalApiHealthResult
  resend: ExternalApiHealthResult
  loki: ExternalApiHealthResult
}

const API_TIMEOUT = 10000

async function checkTacticusApi(
  emitAlerts = true
): Promise<ExternalApiHealthResult> {
  const startTime = Date.now()
  const result: ExternalApiHealthResult = {
    name: 'Tacticus API',
    reachable: false,
    responseTimeMs: 0
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

    const response = await fetch(API_URLS.TACTICUS.BASE, {
      method: 'HEAD',
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    result.responseTimeMs = Date.now() - startTime
    result.statusCode = response.status

    // Any response, even 4xx/5xx, means the service is up.
    result.reachable = true

    if (emitAlerts && response.status >= 500) {
      addInfrastructureAlert(
        'Tacticus API Server Error',
        `Tacticus API returned ${response.status} error`,
        'warning',
        {
          api: 'tacticus',
          statusCode: response.status,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  } catch (error) {
    result.responseTimeMs = Date.now() - startTime
    result.error = error instanceof Error ? error.message : 'Unknown error'

    if (emitAlerts) {
      addInfrastructureAlert(
        'Tacticus API Unreachable',
        `Unable to connect to Tacticus API: ${result.error}`,
        'error',
        {
          api: 'tacticus',
          error: result.error,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  }

  return result
}

async function checkDiscordApi(
  emitAlerts = true
): Promise<ExternalApiHealthResult> {
  const startTime = Date.now()
  const result: ExternalApiHealthResult = {
    name: 'Discord API',
    reachable: false,
    responseTimeMs: 0
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

    const response = await fetch('https://discord.com/api/v10/gateway', {
      method: 'GET',
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    result.responseTimeMs = Date.now() - startTime
    result.statusCode = response.status

    result.reachable = response.status === 200

    if (emitAlerts && !result.reachable && response.status >= 500) {
      addInfrastructureAlert(
        'Discord API Server Error',
        `Discord API returned ${response.status} error`,
        'warning',
        {
          api: 'discord',
          statusCode: response.status,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  } catch (error) {
    result.responseTimeMs = Date.now() - startTime
    result.error = error instanceof Error ? error.message : 'Unknown error'

    if (emitAlerts) {
      addInfrastructureAlert(
        'Discord API Unreachable',
        `Unable to connect to Discord API: ${result.error}`,
        'error',
        {
          api: 'discord',
          error: result.error,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  }

  return result
}

async function checkResendApi(
  emitAlerts = true
): Promise<ExternalApiHealthResult> {
  const startTime = Date.now()
  const result: ExternalApiHealthResult = {
    name: 'Resend API',
    reachable: false,
    responseTimeMs: 0
  }

  if (!process.env.RESEND_API_KEY) {
    result.error = 'Not configured (RESEND_API_KEY missing)'
    return result
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

    const response = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`
      },
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    result.responseTimeMs = Date.now() - startTime
    result.statusCode = response.status

    result.reachable = response.status < 500

    if (emitAlerts && (response.status === 401 || response.status === 403)) {
      addInfrastructureAlert(
        'Resend API Key Invalid',
        'Resend API key is invalid or expired',
        'error',
        {
          api: 'resend',
          statusCode: response.status,
          responseTimeMs: result.responseTimeMs
        }
      )
    } else if (emitAlerts && response.status >= 500) {
      addInfrastructureAlert(
        'Resend API Server Error',
        `Resend API returned ${response.status} error`,
        'warning',
        {
          api: 'resend',
          statusCode: response.status,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  } catch (error) {
    result.responseTimeMs = Date.now() - startTime
    result.error = error instanceof Error ? error.message : 'Unknown error'

    if (emitAlerts) {
      addInfrastructureAlert(
        'Resend API Unreachable',
        `Unable to connect to Resend API: ${result.error}`,
        'error',
        {
          api: 'resend',
          error: result.error,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  }

  return result
}

async function checkLokiApi(
  emitAlerts = true
): Promise<ExternalApiHealthResult> {
  const startTime = Date.now()
  const result: ExternalApiHealthResult = {
    name: 'Loki API',
    reachable: false,
    responseTimeMs: 0
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)

    const response = await fetch(API_URLS.TACTICUS.LOKI, {
      method: 'HEAD',
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    result.responseTimeMs = Date.now() - startTime
    result.statusCode = response.status

    result.reachable = true

    if (emitAlerts && response.status >= 500) {
      addInfrastructureAlert(
        'Loki API Server Error',
        `Loki API returned ${response.status} error`,
        'warning',
        {
          api: 'loki',
          statusCode: response.status,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  } catch (error) {
    result.responseTimeMs = Date.now() - startTime
    result.error = error instanceof Error ? error.message : 'Unknown error'

    if (emitAlerts) {
      addInfrastructureAlert(
        'Loki API Unreachable',
        `Unable to connect to Loki API: ${result.error}`,
        'warning', // Loki is less critical
        {
          api: 'loki',
          error: result.error,
          responseTimeMs: result.responseTimeMs
        }
      )
    }
  }

  return result
}

export async function runExternalApiHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<AllApiHealthResults> {
  const emitAlerts = options.emitAlerts ?? true
  const [tacticus, discord, resend, loki] = await Promise.all([
    checkTacticusApi(emitAlerts),
    checkDiscordApi(emitAlerts),
    checkResendApi(emitAlerts),
    checkLokiApi(emitAlerts)
  ])

  return {
    tacticus,
    discord,
    resend,
    loki
  }
}

export function getExternalApiHealthSummary(results: AllApiHealthResults): {
  allHealthy: boolean
  unhealthyApis: string[]
  totalResponseTimeMs: number
} {
  const unhealthyApis: string[] = []
  let totalResponseTimeMs = 0

  for (const [key, result] of Object.entries(results)) {
    totalResponseTimeMs += result.responseTimeMs
    if (!result.reachable && !result.error?.includes('Not configured')) {
      unhealthyApis.push(key)
    }
  }

  return {
    allHealthy: unhealthyApis.length === 0,
    unhealthyApis,
    totalResponseTimeMs
  }
}
