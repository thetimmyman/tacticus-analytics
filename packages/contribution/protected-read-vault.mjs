import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { uuid } from './contract.mjs'
import { AtomicState } from './storage.mjs'

export class ProtectedReadVault {
  #key
  constructor({
    path,
    encryptionKey,
    upstream,
    now = () => Date.now(),
    retentionMs = 86400000
  }) {
    if (
      !Buffer.isBuffer(encryptionKey) ||
      encryptionKey.length !== 32 ||
      retentionMs > 86400000 ||
      retentionMs <= 0
    )
      throw new Error('Protected credential store required')
    this.#key = Buffer.from(encryptionKey)
    this.upstream = upstream
    this.now = now
    this.retentionMs = retentionMs
    this.store = new AtomicState(path, { version: 1, bindings: {} })
  }
  async enroll(
    principalId,
    {
      separateConsent,
      credentialType,
      accountRef,
      season,
      readOfficialCredential
    }
  ) {
    uuid(principalId)
    uuid(accountRef)
    if (
      separateConsent !== true ||
      credentialType !== 'official-read' ||
      typeof readOfficialCredential !== 'function'
    )
      throw new Error('Native official-read enrollment required')
    let material
    try {
      material = await readOfficialCredential()
      if (
        !Buffer.isBuffer(material) ||
        material.length < 16 ||
        material.length > 512
      )
        throw new Error('Invalid official credential')
      const authority = await this.upstream.fetchGuildRaid(
        material.toString('utf8'),
        season
      )
      uuid(authority.guild?.guildId)
      if (authority.raid?.season !== season)
        throw new Error('Guild Raid scope unavailable')
      const id = randomUUID(),
        iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', this.#key, iv)
      cipher.setAAD(Buffer.from(id))
      const encrypted = Buffer.concat([cipher.update(material), cipher.final()])
      const record = {
        principalId,
        accountRef,
        guildId: authority.guild.guildId,
        expiresAt: this.now() + this.retentionMs,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        encrypted: encrypted.toString('base64')
      }
      this.store.commit({
        ...this.store.value,
        bindings: { ...this.store.value.bindings, [id]: record }
      })
      return {
        bindingId: id,
        guildId: record.guildId,
        accountRef,
        expiresAt: record.expiresAt,
        scopes: ['Guild', 'Guild Raid']
      }
    } catch {
      throw new Error('Official-read enrollment failed')
    } finally {
      material?.fill?.(0)
    }
  }
  binding(principal, bindingId) {
    uuid(bindingId)
    const record = this.store.value.bindings[bindingId]
    if (
      !principal?.authenticated ||
      !record ||
      record.principalId !== principal.id ||
      record.expiresAt <= this.now()
    )
      throw new Error('Verification access unavailable')
    return {
      guildId: record.guildId,
      accountRef: record.accountRef,
      expiresAt: record.expiresAt
    }
  }
  async withRead(principal, bindingId, operation) {
    this.binding(principal, bindingId)
    const record = this.store.value.bindings[bindingId],
      decipher = createDecipheriv(
        'aes-256-gcm',
        this.#key,
        Buffer.from(record.iv, 'base64')
      )
    decipher.setAAD(Buffer.from(bindingId))
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
    const material = Buffer.concat([
      decipher.update(Buffer.from(record.encrypted, 'base64')),
      decipher.final()
    ])
    try {
      return await operation(material.toString('utf8'))
    } finally {
      material.fill(0)
    }
  }
  async remove(principal, bindingId) {
    this.binding(principal, bindingId)
    const state = structuredClone(this.store.value)
    delete state.bindings[bindingId]
    this.store.commit(state)
  }
  purgeExpired() {
    const state = structuredClone(this.store.value)
    for (const [id, record] of Object.entries(state.bindings))
      if (record.expiresAt <= this.now()) delete state.bindings[id]
    this.store.commit(state)
  }
}
