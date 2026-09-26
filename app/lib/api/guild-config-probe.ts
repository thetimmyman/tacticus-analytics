import { TACTICUS_API } from '@tacticus/app-core/app-config'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { resolveLokiBuildString } from '@/app/lib/loki/build-string'
import {
  buildLokiConnectPayload,
  findLokiSessionId
} from '@/app/lib/loki/session-refresh'
import { fetchWithAbortTimeout } from '@/app/lib/sync/api-client'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'
import { toRecord } from '@/app/lib/utils/coerce'

const logger = createComponentLogger('lib.api.guild-config-probe')
type UnknownRecord = Record<string, unknown>

const toRecordArray = (value: unknown): UnknownRecord[] =>
  Array.isArray(value)
    ? value.map(toRecord).filter((row): row is UnknownRecord => Boolean(row))
    : []
const getValue = (record: UnknownRecord | null, key: string): unknown =>
  record ? record[key] : undefined
const pickString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null
const pickNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}
const stringsFrom = (
  records: UnknownRecord[],
  selector: (record: UnknownRecord) => unknown
): string[] =>
  records
    .map((record) => pickString(selector(record)))
    .filter((value): value is string => Boolean(value))
const numbersFrom = (
  records: UnknownRecord[],
  selector: (record: UnknownRecord) => unknown
): number[] =>
  records
    .map((record) => pickNumber(selector(record)))
    .filter((value): value is number => value !== null)

export async function refreshGuildLokiSession(
  guildCode: string,
  userId: string,
  clientSecret: string
): Promise<string | null> {
  try {
    const buildString = await resolveLokiBuildString()
    const response = await fetchWithAbortTimeout(
      `https://api-live.loki.snowprintstudios.com/player/player2/userId/${userId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(
          buildLokiConnectPayload(userId, clientSecret, buildString)
        )
      },
      SERVICE_TIMEOUTS.EXTERNAL_API,
      'create-config external response'
    )
    if (!response.ok) {
      logger.error(
        { guildCode, err: await response.text(), statusCode: response.status },
        'LOKI session refresh failed'
      )
      return null
    }
    const sessionId = findLokiSessionId(await response.json())
    if (!sessionId) {
      logger.warn(
        { guildCode },
        'Session identifier not found in refresh response'
      )
    }
    return sessionId
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { guildCode, err: error },
      'Exception while refreshing LOKI session'
    )
    return null
  }
}

export async function discoverGuildData(apiKey: string) {
  try {
    const response = await fetchWithAbortTimeout(
      `${TACTICUS_API.BASE_URL}/guild`,
      { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } },
      SERVICE_TIMEOUTS.EXTERNAL_API,
      'create-config external response'
    )
    if (!response.ok) {
      logger.warn(
        { data: response.status },
        'Failed to auto-discover guild data'
      )
      return null
    }

    const data = await response.json()
    const dataRecord = toRecord(data)
    const guildRecord = toRecord(getValue(dataRecord, 'guild'))
    const nestedRecord = toRecord(getValue(dataRecord, 'data'))
    const nestedGuild = toRecord(getValue(nestedRecord, 'guild'))
    const rows = toRecordArray(data)
    const nestedRowValue = (row: UnknownRecord, key: string) =>
      getValue(toRecord(getValue(row, 'guild')), key)

    const guildId =
      [
        pickString(getValue(guildRecord, 'guildId')),
        pickString(getValue(guildRecord, 'id')),
        pickString(getValue(dataRecord, 'guildId')),
        pickString(getValue(dataRecord, 'id')),
        pickString(getValue(nestedRecord, 'guildId')),
        pickString(getValue(nestedGuild, 'guildId')),
        pickString(getValue(nestedGuild, 'id')),
        ...stringsFrom(rows, (row) => getValue(row, 'guildId')),
        ...stringsFrom(rows, (row) => nestedRowValue(row, 'guildId'))
      ].find(Boolean) ?? null
    const guildTag =
      [
        pickString(getValue(guildRecord, 'guildTag')),
        pickString(getValue(dataRecord, 'guildTag')),
        pickString(getValue(nestedRecord, 'guildTag')),
        pickString(getValue(nestedGuild, 'guildTag')),
        ...stringsFrom(rows, (row) => getValue(row, 'guildTag')),
        ...stringsFrom(rows, (row) => nestedRowValue(row, 'guildTag'))
      ].find(Boolean) ?? null
    const guildName =
      [
        pickString(getValue(guildRecord, 'name')),
        pickString(getValue(dataRecord, 'name')),
        pickString(getValue(nestedRecord, 'name')),
        pickString(getValue(nestedGuild, 'name')),
        ...stringsFrom(rows, (row) => getValue(row, 'name')),
        ...stringsFrom(rows, (row) => nestedRowValue(row, 'name'))
      ].find(Boolean) ?? null
    const memberCount =
      [
        pickNumber(getValue(guildRecord, 'memberCount')),
        pickNumber(getValue(dataRecord, 'memberCount')),
        pickNumber(getValue(nestedRecord, 'memberCount')),
        pickNumber(getValue(nestedGuild, 'memberCount')),
        ...numbersFrom(rows, (row) => getValue(row, 'memberCount')),
        ...numbersFrom(rows, (row) => nestedRowValue(row, 'memberCount'))
      ].find((value): value is number => value !== null) ?? null
    const userRole =
      [
        pickString(getValue(toRecord(getValue(dataRecord, 'user')), 'role')),
        pickString(getValue(toRecord(getValue(dataRecord, 'member')), 'role')),
        pickString(getValue(dataRecord, 'role')),
        pickString(getValue(toRecord(getValue(nestedRecord, 'user')), 'role')),
        pickString(getValue(nestedRecord, 'role')),
        ...stringsFrom(rows, (row) => getValue(row, 'role'))
      ].find(Boolean) ?? null

    return {
      guildId,
      guildTag,
      guildName,
      memberCount,
      userRole,
      isLeader: userRole
        ? ['leader', 'LEADER', 'Leader'].includes(userRole)
        : false
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Exception during guild auto-discovery')
    return null
  }
}

export async function detectCurrentGuildRaidSeason(
  apiKey: string
): Promise<string | null> {
  try {
    const response = await fetchWithAbortTimeout(
      `${TACTICUS_API.BASE_URL}/guildRaid`,
      { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } },
      SERVICE_TIMEOUTS.EXTERNAL_API,
      'create-config external response'
    )
    if (!response.ok) return null
    const dataRecord = toRecord(await response.json())
    const bodyRecord = toRecord(getValue(dataRecord, 'body'))
    const entries = toRecordArray(getValue(dataRecord, 'entries'))
    const candidates = [
      pickString(getValue(dataRecord, 'season')),
      pickString(getValue(bodyRecord, 'season')),
      pickString(getValue(dataRecord, 'currentSeason')),
      pickString(getValue(entries[0] ?? null, 'season'))
    ]
    return (
      candidates.find(
        (season) => season && season !== 'null' && season !== 'undefined'
      ) ?? null
    )
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Exception detecting guild raid season')
    return null
  }
}
