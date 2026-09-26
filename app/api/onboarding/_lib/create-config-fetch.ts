import {
  SERVICE_TIMEOUTS,
  TimeoutError,
  withResponseBodyTimeout
} from '@/app/lib/utils/async-timeout'
import { buildTrustedInternalUrl } from '@/app/lib/onboarding/internal-url'

export const CREATE_CONFIG_TIMEOUT_MS = SERVICE_TIMEOUTS.EXTERNAL_API * 6

export class CreateConfigTimeoutError extends Error {
  constructor() {
    super('Guild registration timed out')
    this.name = 'CreateConfigTimeoutError'
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'AbortError' ||
    error.message.includes('AbortError') ||
    error.message.includes('Aborted')
  )
}

export function isCreateConfigTimeoutError(error: unknown): boolean {
  return (
    error instanceof CreateConfigTimeoutError || error instanceof TimeoutError
  )
}

export async function fetchCreateConfig(
  request: Request,
  payload: Record<string, unknown>
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    CREATE_CONFIG_TIMEOUT_MS
  )

  try {
    const response = await fetch(
      buildTrustedInternalUrl('/api/guild/create-config'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: request.headers.get('cookie') || ''
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    )
    return withResponseBodyTimeout(
      response,
      CREATE_CONFIG_TIMEOUT_MS,
      'create-config response',
      { onTimeout: () => controller.abort() }
    )
  } catch (error) {
    if (isAbortError(error)) {
      throw new CreateConfigTimeoutError()
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
