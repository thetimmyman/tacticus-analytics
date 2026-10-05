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
  if (
    !player ||
    !metadata ||
    !Array.isArray(player.units) ||
    !metadata.scopes?.includes('Player') ||
    typeof player.details?.name !== 'string' ||
    !Number.isSafeInteger(metadata.lastUpdatedOn)
  )
    throw new Error('Player response unavailable')
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
    upstreamUpdatedAt: metadata.lastUpdatedOn * 1000
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
        'Personal inventory beyond roster and raid resources requires a reviewed projection adapter.'
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
        } catch {
          statuses[scope] = 'unavailable'
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
      if (player) {
        current.personal = player
        current.status = 'active'
        current.vaultReferences.Player = handle
      } else if (!current.personal) current.status = 'player-required'
      for (const scope of scopes) {
        if (scope === 'Player' && !player && previous.personal)
          current.capabilities.Player = 'refresh-unavailable-offline-readable'
        else if (scope === 'Guild' && guild) {
          current.capabilities.Guild = 'verified-scope'
          current.guildId = guild.guild.guildId
          current.vaultReferences.Guild = handle
        } else if (scope === 'Guild Raid' && raid) {
          current.capabilities['Guild Raid'] = 'verified-scope'
          current.vaultReferences['Guild Raid'] = handle
          current.raid = { season: raid.season, syncedAt: this.now() }
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
    } catch {
      if (
        handle &&
        !Object.values(previous.vaultReferences ?? {}).includes(handle)
      )
        await this.vault.remove(handle)
      throw new Error(
        'Secure onboarding could not finish; retained data is available offline'
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
    const current = structuredClone(this.state.read()),
      handle = current.vaultReferences?.[scope]
    delete current.vaultReferences?.[scope]
    current.capabilities ??= {}
    current.capabilities[scope] = 'disconnected-offline-readable'
    this.state.write(current)
    if (
      handle &&
      !Object.values(current.vaultReferences ?? {}).includes(handle)
    )
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
