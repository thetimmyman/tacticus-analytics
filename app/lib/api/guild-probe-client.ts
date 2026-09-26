import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'
import {
  getFirstStringValue,
  getRecordsArrayFromPaths,
  getStringFromRecord
} from '@/app/lib/utils/coerce'

const logger = createComponentLogger('lib.api.guild-probe-client')

export interface ParsedGuildInfo {
  guildId: string | null
  guildName: string | null
  guildCode: string | null
}

export interface RaidInfo {
  hasData: boolean
  entryCount: number
  season: string | null
  bossTypes: string[]
  hasPrimeBosses: boolean
}

export interface MembersInfo {
  memberCount: number
  hasMembers: boolean
  currentUserRole: string | null
}

export const getErrorName = (error: unknown): string => {
  if (error instanceof Error) return error.name
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
  ) {
    return (error as { name: string }).name
  }
  return ''
}

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ''

export const isTimeoutError = (error: unknown): boolean => {
  const errorName = getErrorName(error)
  const lowerMessage = getErrorMessage(error).toLowerCase()
  return errorName === 'AbortError' || lowerMessage.includes('timeout')
}

export async function fetchGuildProbeWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      SERVICE_TIMEOUTS.EXTERNAL_API
    )

    try {
      return await fetch(url, { ...options, signal: controller.signal })
    } catch (error) {
      rethrowIfAppError(error)
      lastError = error
      if (isTimeoutError(error)) throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000
      logger.debug(
        `[TEST-API-KEY] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error('Max retries exceeded')
}

export function extractGuildInfo(data: unknown): ParsedGuildInfo {
  return {
    guildId: getFirstStringValue(data, [
      ['guild', 'guildId'],
      ['guildId'],
      ['id'],
      ['body', 'guild', 'guildId'],
      ['body', 'guildId']
    ]),
    guildName: getFirstStringValue(data, [
      ['guild', 'name'],
      ['name'],
      ['guildName'],
      ['body', 'guild', 'name'],
      ['body', 'name']
    ]),
    guildCode: getFirstStringValue(data, [
      ['guild', 'guildCode'],
      ['guildCode'],
      ['code'],
      ['body', 'guild', 'guildCode'],
      ['body', 'guildCode']
    ])
  }
}

export function detectSeason(data: unknown): string | null {
  const entries = getRecordsArrayFromPaths(data, [
    ['entries'],
    ['body', 'entries']
  ])
  const candidates = [
    getFirstStringValue(data, [['season']]),
    getFirstStringValue(data, [['body', 'season']]),
    getFirstStringValue(data, [['currentSeason']]),
    getFirstStringValue(data, [['guild', 'currentSeason']]),
    getFirstStringValue(data, [['guildRaid', 'season']]),
    entries.length > 0 ? getStringFromRecord(entries[0], 'season') : null
  ]

  for (const candidate of candidates) {
    if (candidate && candidate !== 'null' && candidate !== 'undefined') {
      return candidate
    }
  }

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  return String(Math.floor((currentYear - 2024) * 4 + currentMonth / 3) + 83)
}
