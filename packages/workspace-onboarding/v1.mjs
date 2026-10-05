import playerSchema from './player-schema.json' with { type: 'json' }

export const ONBOARDING_VERSION = 1
export const REQUESTED_CAPABILITIES = Object.freeze([
  'Player',
  'Guild',
  'Guild Raid'
])
const endpoints = Object.freeze({
  Player: '/api/v1/player',
  Guild: '/api/v1/guild',
  'Guild Raid': '/api/v1/guildRaid'
})

function projectPlayer(response) {
  const player = response.player,
    metadata = response.metaData
  if (!metadata?.scopes?.includes('Player'))
    throw new Error('Player response unavailable')
  return projectCachedPlayer({ player, updatedOn: metadata.lastUpdatedOn })
}

// Pure offline projection. This does not establish a live scope or identity.
export function projectCachedPlayer({ player, updatedOn }) {
  if (
    !player ||
    !Array.isArray(player.units) ||
    typeof player.details?.name !== 'string' ||
    !Number.isSafeInteger(updatedOn) ||
    updatedOn < 0 ||
    !Number.isSafeInteger(updatedOn * 1000)
  )
    throw new Error('Player response unavailable')
  const apiData = projectAPI(player, playerSchema.definitions.Player)
  const token = (input) =>
    input &&
    ['current', 'max', 'nextTokenInSeconds', 'regenDelayInSeconds'].every(
      (key) => input[key] === undefined || Number.isSafeInteger(input[key])
    )
      ? Object.fromEntries(
          ['current', 'max', 'nextTokenInSeconds', 'regenDelayInSeconds']
            .filter((key) => input[key] !== undefined)
            .map((key) => [key, input[key]])
        )
      : null
  return {
    displayName: player.details.name.slice(0, 100),
    powerLevel: player.details.powerLevel,
    roster: player.units.map((unit) =>
      Object.fromEntries(
        ['id', 'name', 'faction', 'rank', 'xpLevel', 'progressionIndex']
          .filter((key) => ['string', 'number'].includes(typeof unit[key]))
          .map((key) => [key, unit[key]])
      )
    ),
    resources: {
      guildRaidTokens: token(player.progress?.guildRaid?.tokens),
      bombTokens: token(player.progress?.guildRaid?.bombTokens)
    },
    upstreamUpdatedAt: updatedOn * 1000,
    apiData
  }
}

function projectAPI(value, schema, depth = 0) {
  if (depth > 16) throw new Error('Player response depth limit')
  if (schema.$ref)
    return projectAPI(value, playerSchema.definitions[schema.$ref], depth + 1)
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > 10000)
      throw new Error('Player array unavailable')
    return value.map((entry) => projectAPI(entry, schema.items, depth + 1))
  }
  if (schema.type === 'object') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (schema.required ?? []).some((key) => !Object.hasOwn(value, key))
    )
      throw new Error('Player object unavailable')
    const entries = []
    for (const [key, entry] of Object.entries(value)) {
      if (
        /^(?:__proto__|constructor|prototype|apiKey|api_key|credential|secret|authorization|headers|cookie|sessionToken)$/i.test(
          key
        )
      )
        continue
      const rule = schema.properties?.[key] ?? schema.additionalProperties
      if (!rule) continue
      if (key.length > 100) throw new Error('Player field limit')
      entries.push([key, projectAPI(entry, rule, depth + 1)])
    }
    return Object.fromEntries(entries)
  }
  if (schema.type === 'string') {
    if (
      typeof value !== 'string' ||
      value.length > 1000 ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      (schema.enum && !schema.enum.includes(value))
    )
      throw new Error('Player string unavailable')
    return value
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (schema.type === 'integer' && !Number.isSafeInteger(value)) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum)
    )
      throw new Error('Player number unavailable')
    return value
  }
  if (schema.type === 'boolean' && typeof value === 'boolean') return value
  throw new Error('Unsupported Player projection')
}

function validateScope(response, scope, now) {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    throw new Error('Official response unavailable')
  const metadata = response.metaData
  if (scope === 'Player' && !metadata)
    throw new Error('Player metadata unavailable')
  if (metadata) {
    if (!Array.isArray(metadata.scopes) || !metadata.scopes.includes(scope))
      throw new Error('Official scope unavailable')
    if (
      metadata.apiKeyExpiresOn !== undefined &&
      (!Number.isSafeInteger(metadata.apiKeyExpiresOn) ||
        metadata.apiKeyExpiresOn * 1000 <= now)
    )
      throw Object.assign(new Error('Official access expired'), {
        code: 'EEXPIRED'
      })
  }
  if (
    scope === 'Guild' &&
    (typeof response.guild?.guildId !== 'string' ||
      !response.guild.guildId.length ||
      response.guild.guildId.length > 128)
  )
    throw new Error('Guild identity unavailable')
  if (
    scope === 'Guild Raid' &&
    (!Number.isSafeInteger(response.season) ||
      typeof response.seasonConfigId !== 'string' ||
      !response.seasonConfigId.length ||
      response.seasonConfigId.length > 128 ||
      !Array.isArray(response.entries))
  )
    throw new Error('Raid response unavailable')
}

function rejectHistoricalCredentials(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (
      /^(apiKey|api_key|credential|secret|sessionToken|authorization|headers|cookie)$/i.test(
        key
      )
    )
      throw new Error('Historical credentials require secure native migration')
    rejectHistoricalCredentials(nested)
  }
}

// Device supervisor only: vault owns native input and never returns a key to the renderer.
export class WorkspaceOnboardingV1 {
  constructor({ vault, state, upstream, now = () => Date.now() }) {
    this.vault = vault
    this.state = state
    this.upstream = upstream
    this.now = now
    this.busy = false
  }
  view() {
    const stored = this.state.read()
    return {
      version: 1,
      status: stored.status ?? 'setup',
      requestedCapabilities: [...REQUESTED_CAPABILITIES],
      capabilities: structuredClone(stored.capabilities ?? {}),
      personal: structuredClone(stored.personal ?? null),
      freshness: stored.personal
        ? { syncedAt: stored.personal.upstreamUpdatedAt, offlineReadable: true }
        : null,
      cloudContribution: 'separate-consent-required',
      playerIdentity: 'display-name-only',
      limitation:
        'The official Player snapshot is available for native inspection; application routes still need qualified personal-data adapters.'
    }
  }
  async connect({
    requested = REQUESTED_CAPABILITIES,
    reuseHandle,
    expectedGuildId,
    confirmPlayer
  }) {
    if (this.busy) throw new Error('Workspace setup is already running')
    if (
      !requested.length ||
      requested.some((scope) => !REQUESTED_CAPABILITIES.includes(scope))
    )
      throw new Error('Unsupported capability')
    this.busy = true
    let handle, player, guild, raid, metadata
    const statuses = {},
      previous = this.state.read()
    try {
      handle =
        reuseHandle ??
        (await this.vault.promptAndStoreOfficialRead({
          requestedCapabilities: requested
        }))
      if (typeof handle !== 'string' || !handle)
        throw new Error('Secure credential input unavailable')
      const fetchScope = async (scope) => {
        try {
          const value = await this.vault.withOfficialRead(
            handle,
            async (credential) => {
              const response = await this.upstream.get(scope, credential)
              validateScope(response, scope, this.now())
              const projected =
                scope === 'Player'
                  ? projectPlayer(response)
                  : scope === 'Guild'
                    ? { guildId: response.guild?.guildId }
                    : { season: response.season }
              const serialized = JSON.stringify(projected)
              const variants = [
                credential,
                Buffer.from(credential).toString('base64'),
                Buffer.from(credential).toString('hex'),
                encodeURIComponent(credential)
              ]
              if (variants.some((value) => value && serialized.includes(value)))
                throw new Error('Unsafe official response')
              return response
            }
          )
          statuses[scope] = 'verified-scope'
          return value
        } catch (error) {
          statuses[scope] =
            error.code === 'EEXPIRED'
              ? 'expired-offline-readable'
              : error.code === 'EVAULTLOCKED'
                ? 'vault-locked-offline-readable'
                : 'unavailable'
          return null
        }
      }
      if (requested.includes('Player')) {
        const response = await fetchScope('Player')
        if (response) {
          try {
            metadata = response.metaData
            player = projectPlayer(response)
            if (
              metadata.apiKeyExpiresOn !== undefined &&
              metadata.apiKeyExpiresOn * 1000 <= this.now()
            )
              throw new Error('Expired access')
            if (
              typeof confirmPlayer !== 'function' ||
              !(await confirmPlayer({
                displayName: player.displayName,
                identityProof: 'display-name-only'
              }))
            )
              throw new Error('Player confirmation required')
          } catch {
            player = null
            statuses.Player = 'unavailable'
          }
        }
      }
      // Metadata from a successful Player read can discover combined scopes without another prompt.
      const scopes = new Set([
        ...requested,
        ...(metadata?.scopes?.filter((scope) =>
          REQUESTED_CAPABILITIES.includes(scope)
        ) ?? [])
      ])
      if (scopes.has('Guild Raid')) scopes.add('Guild')
      if (scopes.has('Guild') || scopes.has('Guild Raid'))
        guild = await fetchScope('Guild')
      if (
        guild &&
        (typeof guild.guild?.guildId !== 'string' ||
          (expectedGuildId && guild.guild.guildId !== expectedGuildId))
      ) {
        guild = null
        statuses.Guild = 'wrong-guild'
      }
      if (scopes.has('Guild Raid')) {
        // The raid response has no guild identity; same-key Guild access is needed to bind it.
        if (guild) raid = await fetchScope('Guild Raid')
        else statuses['Guild Raid'] = 'guild-binding-unavailable'
      }
      const current = structuredClone(previous)
      current.version = 1
      current.capabilities ??= {}
      current.vaultReferences ??= {}
      const invalidate = (scope, status) => {
        delete current.vaultReferences[scope]
        current.capabilities[scope] = status
      }
      if (
        player &&
        previous.personal &&
        previous.vaultReferences?.Player !== handle
      ) {
        invalidate('Guild', 'account-changed-offline-readable')
        invalidate('Guild Raid', 'account-changed-offline-readable')
        delete current.guildId
      }
      if (
        scopes.has('Guild') &&
        (!guild ||
          guild.guild.guildId !== previous.guildId ||
          previous.vaultReferences?.Guild !== handle)
      )
        invalidate('Guild Raid', 'guild-binding-unavailable')
      if (player) {
        current.personal = player
        current.status = 'active'
        current.vaultReferences.Player = handle
      } else if (!current.personal) current.status = 'player-required'
      for (const scope of scopes) {
        if (scope === 'Player' && !player && previous.personal)
          current.capabilities.Player = [
            'expired-offline-readable',
            'vault-locked-offline-readable'
          ].includes(statuses.Player)
            ? statuses.Player
            : 'refresh-unavailable-offline-readable'
        else if (scope === 'Guild' && guild) {
          current.capabilities.Guild = 'verified-scope'
          current.guildId = guild.guild.guildId
          current.vaultReferences.Guild = handle
        } else if (scope === 'Guild Raid' && raid) {
          current.capabilities['Guild Raid'] = 'verified-scope'
          current.vaultReferences['Guild Raid'] = handle
          current.raid = {
            season: raid.season,
            guildId: guild.guild.guildId,
            syncedAt: this.now()
          }
        } else current.capabilities[scope] = statuses[scope] ?? 'unavailable'
      }
      this.state.write(current)
      if (!Object.values(current.vaultReferences).includes(handle))
        await this.vault.remove(handle)
      for (const oldHandle of new Set(
        Object.values(previous.vaultReferences ?? {})
      )) {
        if (
          oldHandle !== handle &&
          !Object.values(current.vaultReferences).includes(oldHandle)
        )
          await this.vault.remove(oldHandle)
      }
      return this.view()
    } catch (error) {
      if (
        handle &&
        !Object.values(previous.vaultReferences ?? {}).includes(handle)
      )
        await this.vault.remove(handle)
      throw Object.assign(
        new Error(
          'Secure onboarding could not finish; retained data is available offline'
        ),
        {
          code: [
            'EVAULTLOCKED',
            'EVAULT',
            'EEXPIRED',
            'EUPSTREAM',
            'ESESSION',
            'ECANCELLED'
          ].includes(error.code)
            ? error.code
            : 'EACCESS'
        }
      )
    } finally {
      this.busy = false
    }
  }
  async skipOptional() {
    const current = this.state.read()
    if (!current.personal)
      throw new Error('Player access is required for a new personal workspace')
    return this.view()
  }
  migrateHistorical(profile) {
    rejectHistoricalCredentials(profile)
    if (this.state.read().personal)
      throw new Error('Workspace already initialized')
    this.state.write({
      ...structuredClone(profile),
      version: 1,
      status: 'historical-offline',
      capabilities: { Player: 'reconnect-required' }
    })
    return this.view()
  }
  async disconnect(scope) {
    if (!REQUESTED_CAPABILITIES.includes(scope))
      throw new Error('Unsupported capability')
    const previous = this.state.read(),
      current = structuredClone(previous)
    delete current.vaultReferences?.[scope]
    current.capabilities ??= {}
    current.capabilities[scope] = 'disconnected-offline-readable'
    if (scope === 'Guild') {
      delete current.guildId
      delete current.vaultReferences?.['Guild Raid']
      current.capabilities['Guild Raid'] = 'guild-binding-unavailable'
    }
    this.state.write(current)
    for (const handle of new Set(Object.values(previous.vaultReferences ?? {})))
      if (!Object.values(current.vaultReferences ?? {}).includes(handle))
        await this.vault.remove(handle)
    return this.view()
  }
}

export class DeviceOfficialSourceV1 {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl
  }
  async get(scope, credential) {
    if (!Object.hasOwn(endpoints, scope))
      throw new Error('Unsupported capability')
    const response = await this.fetch(
      `https://api.tacticusgame.com${endpoints[scope]}`,
      {
        redirect: 'error',
        method: 'GET',
        headers: { 'X-API-KEY': credential, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      }
    )
    if (!response.ok) throw new Error('Official access unavailable')
    const reader = response.body?.getReader(),
      chunks = []
    if (!reader) throw new Error('Official response unavailable')
    let bytes = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('Official response limit')
      }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
}
