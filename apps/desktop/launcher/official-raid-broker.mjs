import { parseRaidFile, RAID_FILE_MAX_BYTES } from './raid-file-validation.mjs'
import { projectOfficialRoster } from './roster-validation.mjs'

const upstream = 'https://api.tacticusgame.com'
const failure = () =>
  Object.assign(
    new Error('Game connection is unavailable. Reconnect or try again.'),
    { code: 'EBROKER' }
  )
const revoked = () => Object.assign(failure(), { revoke: true })
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)

// Trusted main-process operations only. No discovery, renderer secret interface,
// caller-selected destinations, redirects, request bodies or signing operations.
// Consent binds an installation and guild; the official player response does
// not identify a player UID, so this client never asserts local player ownership.
export class OfficialRaidBroker {
  #vault
  #consent
  #fetch
  #clock
  #generation = 0
  #active
  #busy = false
  #requests = new Set()
  constructor({
    vault,
    consent = () => null,
    fetch = globalThis.fetch,
    clock = Date.now
  }) {
    this.#vault = vault
    this.#consent = consent
    this.#fetch = fetch
    this.#clock = clock
  }
  #grant() {
    const value = this.#consent()
    if (
      !object(value) ||
      value.operation !== 'official-guild-raids' ||
      typeof value.installation !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        value.installation
      ) ||
      typeof value.guildCode !== 'string' ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(value.guildCode)
    )
      throw revoked()
    return { installation: value.installation, guildCode: value.guildCode }
  }
  #check(binding, generation) {
    const grant = this.#grant()
    if (
      generation !== this.#generation ||
      grant.installation !== binding.installation ||
      grant.guildCode !== binding.guildCode
    )
      throw revoked()
    if (binding.expiresAt !== undefined && binding.expiresAt <= this.#clock())
      throw revoked()
  }
  async #read(path, secret, binding, generation, maxBytes) {
    this.#check(binding, generation)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    this.#requests.add(controller)
    let response
    try {
      response = await this.#fetch(upstream + path, {
        method: 'GET',
        headers: { 'X-API-KEY': secret, accept: 'application/json' },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      })
      this.#check(binding, generation)
      if (response.status === 403) throw revoked()
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
        throw failure()
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > maxBytes) throw failure()
      const reader = response.body?.getReader()
      if (!reader) throw failure()
      let size = 0
      const parts = []
      try {
        for (;;) {
          this.#check(binding, generation)
          const part = await reader.read()
          this.#check(binding, generation)
          if (part.done) break
          size += part.value.byteLength
          if (size > maxBytes) throw failure()
          parts.push(part.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const result = JSON.parse(Buffer.concat(parts).toString('utf8'))
      // Upstream-controlled content must not echo the authentication value into
      // results, diagnostics, stored raid data or errors.
      const serialized = JSON.stringify(result)
      const encodedSecrets = [
        secret,
        secret.toLowerCase(),
        secret.toUpperCase(),
        secret.replaceAll('-', ''),
        Buffer.from(secret).toString('base64'),
        Buffer.from(secret).toString('base64url'),
        Buffer.from(secret).toString('hex')
      ]
      if (
        !object(result) ||
        encodedSecrets.some((value) => serialized.includes(value))
      )
        throw failure()
      return result
    } finally {
      clearTimeout(timeout)
      controller.abort()
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => {})
      this.#requests.delete(controller)
    }
  }
  async #binding(secret, binding, generation, includeRoster = false) {
    const player = await this.#read(
      '/api/v1/player',
      secret,
      binding,
      generation,
      4 * 1024 * 1024
    )
    const metadata = player.metaData
    if (
      !object(player.player) ||
      !object(metadata) ||
      !Array.isArray(metadata.scopes) ||
      metadata.scopes.length > 32 ||
      metadata.scopes.some(
        (scope) => typeof scope !== 'string' || scope.length > 64
      )
    )
      throw failure()
    let expiresAt
    if (
      metadata.apiKeyExpiresOn !== undefined &&
      metadata.apiKeyExpiresOn !== null
    ) {
      if (
        !Number.isSafeInteger(metadata.apiKeyExpiresOn) ||
        metadata.apiKeyExpiresOn <= 0
      )
        throw failure()
      expiresAt = metadata.apiKeyExpiresOn * 1000
      if (!Number.isSafeInteger(expiresAt) || expiresAt > Date.UTC(2100, 0, 1))
        throw failure()
      if (expiresAt <= this.#clock()) throw revoked()
    }
    const checked = { ...binding, expiresAt }
    const response = await this.#read(
      '/api/v1/guild',
      secret,
      checked,
      generation,
      1024 * 1024
    )
    const guild = response.guild
    if (
      !object(guild) ||
      guild.guildTag !== binding.guildCode ||
      typeof guild.guildId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(guild.guildId)
    )
      throw revoked()
    if (binding.guildId !== undefined && guild.guildId !== binding.guildId)
      throw revoked()
    this.#check(checked, generation)
    return {
      ...checked,
      guildId: guild.guildId,
      ...(includeRoster ? { roster: projectOfficialRoster(player.player) } : {})
    }
  }
  async connect(secret, ...arguments_) {
    if (arguments_.length || this.#busy || this.#active) throw failure()
    this.#busy = true
    let handle
    const generation = this.#generation
    try {
      const binding = this.#grant()
      if (
        typeof secret !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(secret)
      )
        throw failure()
      const checked = await this.#binding(secret, binding, generation)
      this.#check(checked, generation)
      handle = await this.#vault.save(secret)
      this.#check(checked, generation)
      this.#active = { ...checked, handle }
      return this.status()
    } catch {
      if (handle) await this.#vault.forget(handle).catch(() => {})
      throw failure()
    } finally {
      this.#busy = false
    }
  }
  // These records are for trusted main-process persistence, never renderer IPC.
  savedConnection() {
    if (!this.#active) return null
    this.#check(this.#active, this.#generation)
    return { ...this.#active }
  }
  async resume(record, ...arguments_) {
    if (arguments_.length || this.#busy || this.#active) throw failure()
    this.#busy = true
    const generation = this.#generation
    try {
      const grant = this.#grant()
      if (
        !object(record) ||
        Object.keys(record).some(
          (key) =>
            ![
              'installation',
              'guildCode',
              'guildId',
              'expiresAt',
              'handle'
            ].includes(key)
        ) ||
        typeof record.handle !== 'string' ||
        !/^[a-f0-9]{32}$/.test(record.handle) ||
        typeof record.guildId !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
          record.guildId
        ) ||
        (record.expiresAt !== undefined &&
          !Number.isSafeInteger(record.expiresAt))
      )
        throw failure()
      this.#check(record, generation)
      const checked = await this.#vault.withCredential(
        record.handle,
        (secret) =>
          this.#binding(
            secret,
            { ...grant, guildId: record.guildId, expiresAt: record.expiresAt },
            generation
          )
      )
      this.#check(checked, generation)
      this.#active = { ...checked, handle: record.handle }
      return this.status()
    } catch {
      throw failure()
    } finally {
      this.#busy = false
    }
  }
  close() {
    this.#generation++
    this.#active = undefined
    for (const request of this.#requests) request.abort()
  }
  status() {
    if (!this.#active) return { connected: false }
    try {
      this.#check(this.#active, this.#generation)
    } catch {
      return { connected: false }
    }
    return {
      connected: true,
      guildCode: this.#active.guildCode,
      expiresAt: this.#active.expiresAt ?? null
    }
  }
  async currentRaids(...arguments_) {
    if (arguments_.length || this.#busy || !this.#active) throw failure()
    this.#busy = true
    const binding = this.#active,
      generation = this.#generation
    let shouldRevoke = false
    try {
      this.#check(binding, generation)
      return await this.#vault.withCredential(
        binding.handle,
        async (secret) => {
          try {
            const checked = await this.#binding(secret, binding, generation)
            const raid = await this.#read(
              '/api/v1/guildRaid',
              secret,
              checked,
              generation,
              RAID_FILE_MAX_BYTES
            )
            if (
              !Number.isSafeInteger(raid.season) ||
              raid.season < 1 ||
              raid.season > 999999 ||
              !Array.isArray(raid.entries) ||
              raid.entries.length > 10000
            )
              throw failure()
            if (raid.entries.length === 0) {
              this.#check(checked, generation)
              this.#active = { ...checked, handle: binding.handle }
              return { contents: null, season: raid.season }
            }
            const contents = JSON.stringify({
              format: 'ta-raid-file-v1',
              guildCode: checked.guildCode,
              season: raid.season,
              entries: raid.entries
            })
            parseRaidFile(contents)
            this.#check(checked, generation)
            this.#active = { ...checked, handle: binding.handle }
            return { contents }
          } catch (error) {
            shouldRevoke = error.revoke === true
            throw error
          }
        }
      )
    } catch (error) {
      if (shouldRevoke || error.revoke === true) await this.disconnect()
      throw failure()
    } finally {
      this.#busy = false
    }
  }
  async currentRoster(...arguments_) {
    if (arguments_.length || this.#busy || !this.#active) throw failure()
    this.#busy = true
    const binding = this.#active,
      generation = this.#generation
    let shouldRevoke = false
    try {
      this.#check(binding, generation)
      return await this.#vault.withCredential(
        binding.handle,
        async (secret) => {
          try {
            const { roster, ...checked } = await this.#binding(
              secret,
              binding,
              generation,
              true
            )
            this.#check(checked, generation)
            this.#active = { ...checked, handle: binding.handle }
            return { ...roster, guildCode: checked.guildCode }
          } catch (error) {
            shouldRevoke = error.revoke === true
            throw error
          }
        }
      )
    } catch (error) {
      if (shouldRevoke || error.revoke === true) await this.disconnect()
      throw failure()
    } finally {
      this.#busy = false
    }
  }
  async disconnect() {
    this.#generation++
    const active = this.#active
    this.#active = undefined
    for (const request of this.#requests) request.abort()
    if (active) {
      try {
        await this.#vault.forget(active.handle)
      } catch {
        throw failure()
      }
    }
    return { connected: false }
  }
}
