import 'server-only'

import { createLokiClient } from '@/app/lib/loki/client'
import { Errors } from '@/app/lib/errors/AppError'

export interface LokiCredentialVerification {
  sessionId: string
}

/** CONNECTs to live LOKI for a fresh sessionId; throws a classified AppError (401/408/503/502)
 * so callers can show an actionable message. */
export async function verifyLokiCredentials(
  userId: string,
  clientSecret: string
): Promise<LokiCredentialVerification> {
  const client = createLokiClient({ userId, clientSecret })
  const result = await client.refreshSession()

  if (result.ok && result.data?.sessionId) {
    return { sessionId: result.data.sessionId }
  }

  const error = result.ok ? undefined : result.error
  const status = error?.status
  const lowerMessage = (error?.message ?? '').toLowerCase()

  if (error?.isAuthError || status === 401 || status === 403) {
    throw Errors.fromResponse(401, {
      success: false,
      error:
        'Tacticus rejected these credentials. Double-check the User ID and Client Secret are copied exactly, from a player currently in this guild.'
    })
  }

  if (lowerMessage.includes('timed out')) {
    throw Errors.fromResponse(408, {
      success: false,
      error: 'Connection to Tacticus timed out. Please try again in a moment.'
    })
  }

  if (lowerMessage.includes('failed to reach')) {
    throw Errors.fromResponse(503, {
      success: false,
      error: 'Could not reach the Tacticus servers. Please try again shortly.'
    })
  }

  throw Errors.fromResponse(
    typeof status === 'number' && status >= 400 ? status : 502,
    {
      success: false,
      error:
        'Tacticus did not return a valid session. The credentials may be invalid or expired.'
    }
  )
}
