import { projectOfficialRoster } from './roster-validation.mjs'
import { parseRaidFile, RAID_FILE_MAX_BYTES } from './raid-file-validation.mjs'

const upstream = 'https://api.tacticusgame.com'
const paths = new Set(['/api/v1/player', '/api/v1/guild', '/api/v1/guildRaid'])
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
const unavailable = (code = 'EUPSTREAMDATA') =>
  Object.assign(
    new Error(
      'API access could not be verified. Check the key, its scopes and your connection.'
    ),
    { code }
  )
const number = (value, max) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw unavailable()
  return value
}
const token = (value) => {
  if (value == null) return null
  if (!object(value)) throw unavailable()
  const result = {
    current: number(value.current, 100000),
    max: number(value.max, 100000),
    nextTokenInSeconds:
      value.nextTokenInSeconds == null
        ? null
        : number(value.nextTokenInSeconds, 366 * 86400),
    regenDelayInSeconds: number(value.regenDelayInSeconds, 366 * 86400)
  }
  if (result.current > result.max) throw unavailable()
  return result
}

export function projectPlayerResources(value) {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !['tokens', 'bombs', 'upstreamUpdatedAt'].includes(key)
    )
  )
    throw unavailable()
  const updated = value.upstreamUpdatedAt
  if (updated != null) number(updated, Date.UTC(2100, 0, 1))
  return {
    tokens: token(value.tokens),
    bombs: token(value.bombs),
    upstreamUpdatedAt: updated ?? null
  }
}

// Trusted native code only. No caller-selected origin, redirects or write APIs.
export async function readOfficialAccess(
  path,
  key,
  { fetch: request = globalThis.fetch, signal } = {}
) {
  if (
    !paths.has(path) ||
    typeof key !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(key)
  )
    throw unavailable('EKEYFORMAT')
  const timeout = AbortSignal.timeout(20000)
  let response
  try {
    response = await request(upstream + path, {
      method: 'GET',
      headers: { 'X-API-KEY': key, accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    if (response.status === 401 || response.status === 403)
      throw unavailable('EUPSTREAMAUTH')
    if (response.status === 429) throw unavailable('EUPSTREAMRATE')
    if (response.status >= 500) throw unavailable('EUPSTREAMSERVICE')
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== upstream + path) ||
      response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase() !== 'application/json'
    )
      throw unavailable()
    const limit =
      path === '/api/v1/guildRaid' ? RAID_FILE_MAX_BYTES : 4 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit)
      throw unavailable()
    const reader = response.body?.getReader()
    if (!reader) throw unavailable()
    const chunks = []
    let bytes = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > limit) throw unavailable()
        chunks.push(part.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const text = Buffer.concat(chunks).toString('utf8')
    const canaries = [
      key,
      key.toLowerCase(),
      key.toUpperCase(),
      key.replaceAll('-', ''),
      Buffer.from(key).toString('base64'),
      Buffer.from(key).toString('base64url'),
      Buffer.from(key).toString('hex')
    ]
    if (canaries.some((value) => text.includes(value))) throw unavailable()
    const result = JSON.parse(text)
    if (!object(result)) throw unavailable()
    return result
  } catch (error) {
    if (
      [
        'EUPSTREAMDATA',
        'EUPSTREAMAUTH',
        'EUPSTREAMRATE',
        'EUPSTREAMSERVICE'
      ].includes(error.code)
    )
      throw error
    throw unavailable(
      error instanceof SyntaxError ? 'EUPSTREAMDATA' : 'ENETWORK'
    )
  } finally {
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {})
  }
}

export function projectPlayerAccess(value, clock = Date.now) {
  if (
    !object(value) ||
    !object(value.player) ||
    (value.metaData != null && !object(value.metaData))
  )
    throw unavailable()
  const metadata = value.metaData ?? {}
  // A successful authenticated Player endpoint establishes Player access.
  // Scope metadata is optional; explicit contradictory scopes still refuse.
  if (
    metadata.scopes != null &&
    (!Array.isArray(metadata.scopes) ||
      metadata.scopes.length > 32 ||
      !metadata.scopes.includes('Player'))
  )
    throw unavailable()
  const scopes = (metadata.scopes ?? ['Player']).filter((scope) =>
    ['Player', 'Guild', 'Guild Raid'].includes(scope)
  )
  let expiresAt = null
  if (metadata.apiKeyExpiresOn != null) {
    expiresAt =
      number(metadata.apiKeyExpiresOn, Date.UTC(2100, 0, 1) / 1000) * 1000
    if (expiresAt <= clock()) throw unavailable()
  }
  const updated = metadata.lastUpdatedOn
  if (updated != null) number(updated, Date.UTC(2100, 0, 1) / 1000)
  const progress = value.player.progress
  if (progress != null && !object(progress)) throw unavailable()
  const raid = progress?.guildRaid
  if (raid != null && !object(raid)) throw unavailable()
  return {
    roster: projectOfficialRoster(value.player),
    tokens: token(raid?.tokens),
    bombs: token(raid?.bombTokens),
    scopes: [...new Set(scopes)],
    expiresAt,
    upstreamUpdatedAt: updated == null ? null : updated * 1000
  }
}

export async function verifyOfficialAccess(
  scope,
  key,
  guildCode,
  options = {}
) {
  if (
    !['Player', 'Guild', 'Guild Raid'].includes(scope) ||
    typeof guildCode !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(guildCode)
  )
    throw unavailable()
  if (scope === 'Player')
    return projectPlayerAccess(
      await readOfficialAccess('/api/v1/player', key, options),
      options.clock
    )
  const value = await readOfficialAccess('/api/v1/guild', key, options)
  const guild = value.guild
  if (
    !object(guild) ||
    typeof guild.guildId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(guild.guildId)
  )
    throw unavailable()
  if (guild.guildTag !== guildCode) throw unavailable('EGUILDMISMATCH')
  const result = { guildId: guild.guildId, guildCode }
  if (scope === 'Guild Raid') {
    // Guild access on the raid credential independently binds its current guild.
    const raid = await readOfficialAccess('/api/v1/guildRaid', key, options)
    number(raid.season, 999999)
    if (
      !raid.season ||
      !Array.isArray(raid.entries) ||
      raid.entries.length > 10000
    )
      throw unavailable()
    result.season = raid.season
    result.contents = raid.entries.length
      ? JSON.stringify({
          format: 'ta-raid-file-v1',
          ...parseRaidFile(
            JSON.stringify({
              format: 'ta-raid-file-v1',
              guildCode,
              season: raid.season,
              entries: raid.entries
            })
          )
        })
      : null
  }
  return result
}
