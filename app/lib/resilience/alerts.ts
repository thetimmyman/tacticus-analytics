import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.resilience.alerts')
import type { CircuitState, StateChangeCallback } from './circuit-breaker'

const OPS_WEBHOOK_URL = (
  process.env.CIRCUIT_BREAKER_WEBHOOK_URL ||
  process.env.MONITORING_WEBHOOK_URL ||
  ''
).trim()
const DISCORD_ALERTS_ENABLED =
  String(process.env.DISCORD_ALERTS_ENABLED ?? '').toLowerCase() === 'true'

interface DiscordEmbed {
  title: string
  description: string
  color: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  timestamp?: string
}

const STATE_COLORS = {
  OPEN: 0xff0000, // Red - circuit is failing
  HALF_OPEN: 0xffaa00, // Orange - testing recovery
  CLOSED: 0x00ff00 // Green - healthy
} as const

const STATE_EMOJIS = {
  OPEN: '🔴',
  HALF_OPEN: '🟠',
  CLOSED: '🟢'
} as const

async function sendCircuitAlert(
  circuitName: string,
  previousState: CircuitState,
  newState: CircuitState
): Promise<void> {
  const isSignificant =
    newState === 'OPEN' || // Always alert when opening
    (previousState === 'OPEN' && newState === 'CLOSED') // Alert on recovery

  if (!isSignificant) {
    logger.debug(
      `Circuit "${circuitName}" transition ${previousState} -> ${newState} (not alerting)`
    )
    return
  }

  const embed: DiscordEmbed = {
    title: `${STATE_EMOJIS[newState]} Circuit Breaker: ${circuitName}`,
    description:
      newState === 'OPEN'
        ? `**Circuit OPENED** - External service is failing. Requests will be rejected until recovery.`
        : `**Circuit RECOVERED** - External service is healthy again.`,
    color: STATE_COLORS[newState],
    fields: [
      { name: 'Previous State', value: previousState, inline: true },
      { name: 'New State', value: newState, inline: true },
      {
        name: 'Environment',
        value: process.env.NODE_ENV || 'development',
        inline: true
      }
    ],
    timestamp: new Date().toISOString()
  }

  if (!OPS_WEBHOOK_URL) {
    logger.debug(
      `Circuit "${circuitName}" alert skipped (webhook not configured)`
    )
    return
  }

  if (!DISCORD_ALERTS_ENABLED) {
    logger.debug(
      `Circuit "${circuitName}" alert skipped (DISCORD_ALERTS_ENABLED=false)`
    )
    return
  }

  try {
    const response = await fetch(OPS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Circuit Breaker Monitor',
        embeds: [embed]
      })
    })

    if (!response.ok) {
      logger.warn(
        {
          status: response.status,
          circuit: circuitName
        },
        'Failed to send circuit alert to Discord'
      )
    } else {
      logger.info(
        `Circuit alert sent for "${circuitName}": ${previousState} -> ${newState}`
      )
    }
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        circuit: circuitName
      },
      'Error sending circuit alert'
    )
  }
}

const createAlertCallback = (): StateChangeCallback => {
  return (circuitName, previousState, newState) => {
    return sendCircuitAlert(circuitName, previousState, newState)
  }
}

export const alertOnStateChange = createAlertCallback()
