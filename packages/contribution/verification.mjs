import { createHash, createHmac, randomUUID } from 'node:crypto'
import { envelope, allowed, consent, raidRow, receipt } from './contract.mjs'
import { AtomicState } from './storage.mjs'

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const eventIdentity = (row) =>
  [
    row.userId,
    row.startedOn,
    row.completedOn,
    row.unitId,
    row.tier,
    row.set,
    row.encounterIndex,
    row.damageType
  ].join('/')

// Deploy only behind a reviewed authenticated service and protected read-credential adapter.
export class VerificationService {
  #tail = Promise.resolve()
  constructor({
    path,
    upstream,
    credentialStore,
    attributionKey,
    now = () => Date.now(),
    minimumGuilds = 5,
    windowMs = 300000
  }) {
    if (
      !Buffer.isBuffer(attributionKey) ||
      attributionKey.length !== 32 ||
      !Number.isSafeInteger(minimumGuilds) ||
      minimumGuilds < 3
    )
      throw new Error('Protected verification configuration required')
    this.store = new AtomicState(path, {
      version: 1,
      policies: {},
      requests: {},
      rates: {},
      records: {}
    })
    this.upstream = upstream
    this.credentials = credentialStore
    this.attributionKey = attributionKey
    this.now = now
    this.minimumGuilds = minimumGuilds
    this.windowMs = windowMs
  }
  async enroll(principal, input) {
    if (
      !principal?.authenticated ||
      !input?.separateConsent ||
      input.credentialType !== 'official-read'
    )
      throw new Error('Separate official-read enrollment consent required')
    // Native enrollment calls the protected adapter directly; no renderer/public route receives a key.
    return this.credentials.enroll(principal.id, input)
  }
  setPolicy(principal, bindingId, input) {
    const binding = this.credentials.binding(principal, bindingId),
      policy = consent(input)
    if (
      policy.purpose !== 'meta' ||
      policy.guildId !== binding.guildId ||
      policy.accountRef !== binding.accountRef
    )
      throw new Error('Verification binding mismatch')
    const key = `${bindingId}/meta`,
      old = this.store.value.policies[key]
    if (old && policy.revision <= old.revision)
      throw new Error('Consent revision must increase')
    this.store.commit({
      ...this.store.value,
      policies: { ...this.store.value.policies, [key]: policy }
    })
  }
  verify(principal, input) {
    const action = this.#tail.then(() => this.#verify(principal, input))
    this.#tail = action.catch(() => {})
    return action
  }
  async #verify(principal, input) {
    this.purgeRetention()
    const upload = envelope(input),
      binding = this.credentials.binding(principal, upload.bindingId)
    const policyKey = `${upload.bindingId}/meta`,
      policy = this.store.value.policies[policyKey]
    if (
      upload.purpose !== 'meta' ||
      upload.guildId !== binding.guildId ||
      !policy ||
      !allowed(policy, upload, this.now())
    )
      throw new Error('Contribution is not authorized')
    const requestKey = `${upload.bindingId}/${upload.requestId}`,
      bodyDigest = digest(upload)
    const previous = this.store.value.requests[requestKey]
    if (previous) {
      if (previous.bodyDigest !== bodyDigest)
        throw new Error('Request identity reused')
      return structuredClone(previous.receipt)
    }
    const rate = this.store.value.rates[principal.id]
    if (rate && this.now() - rate.from < 60000 && rate.count >= 20)
      throw new Error('Verification rate limit')
    const rates = {
      ...this.store.value.rates,
      [principal.id]:
        !rate || this.now() - rate.from >= 60000
          ? { from: this.now(), count: 1 }
          : { ...rate, count: rate.count + 1 }
    }
    this.store.commit({ ...this.store.value, rates })
    const checkedAt = new Date(this.now()).toISOString()
    const result = (status) =>
      receipt({
        version: 1,
        requestId: upload.requestId,
        consentRevision: upload.consentRevision,
        checkedAt,
        source: 'official-guild-raid',
        results: upload.rows.map((_, index) => ({
          index,
          status,
          authorityDigest: null
        }))
      })
    if (Math.abs(this.now() - Date.parse(upload.observedAt)) > this.windowMs)
      return result('expired')
    if (upload.dataset !== 'raid') return result('unverifiable')
    let authority
    try {
      authority = await this.credentials.withRead(
        principal,
        upload.bindingId,
        (credential) => this.upstream.fetchGuildRaid(credential, upload.season)
      )
    } catch (error) {
      if (error?.code === 'FORBIDDEN')
        await this.credentials.remove(principal, upload.bindingId)
      return result(error?.code === 'FORBIDDEN' ? 'expired' : 'pending')
    }
    // Recheck policy and active binding after the upstream await, including revocation races.
    this.credentials.binding(principal, upload.bindingId)
    const currentPolicy = this.store.value.policies[policyKey]
    if (!currentPolicy || !allowed(currentPolicy, upload, this.now()))
      throw new Error('Contribution consent revoked')
    if (
      authority.guild?.guildId !== binding.guildId ||
      authority.raid?.season !== upload.season ||
      !Array.isArray(authority.guild?.members) ||
      !Array.isArray(authority.raid?.entries) ||
      !Number.isFinite(Date.parse(authority.fetchedAt)) ||
      Math.abs(this.now() - Date.parse(authority.fetchedAt)) > this.windowMs
    )
      return result('pending')
    const members = new Set(
      authority.guild.members.map((member) => member.userId)
    )
    const authoritativeRows = new Map()
    const ambiguous = new Set()
    for (const row of authority.raid.entries) {
      try {
        const projected = raidRow(
          Object.fromEntries(
            [
              'userId',
              'tier',
              'set',
              'encounterIndex',
              'damageDealt',
              'damageType',
              'startedOn',
              'completedOn',
              'unitId'
            ].map((key) => [key, row[key]])
          )
        )
        if (members.has(projected.userId)) {
          const id = eventIdentity(projected)
          if (authoritativeRows.has(id)) ambiguous.add(id)
          authoritativeRows.set(id, projected)
        }
      } catch {
        /* A partial or malformed upstream row cannot verify a client row. */
      }
    }
    const state = structuredClone(this.store.value)
    const results = upload.rows.map((row, index) => {
      const authoritative = authoritativeRows.get(eventIdentity(row))
      if (ambiguous.has(eventIdentity(row)))
        return { index, status: 'pending', authorityDigest: null }
      if (!authoritative || digest(authoritative) !== digest(row))
        return { index, status: 'mismatch', authorityDigest: null }
      const authorityDigest = digest(authoritative)
      const eventKey = createHmac('sha256', this.attributionKey)
        .update(
          `${binding.guildId}/${upload.season}/${eventIdentity(authoritative)}`
        )
        .digest('hex')
      const old = state.records[eventKey],
        duplicate = old && old.authorityDigest === authorityDigest
      const guildRef = createHmac('sha256', this.attributionKey)
        .update(binding.guildId)
        .digest('hex')
      const attributions = {
        ...(old?.attributions ?? {}),
        [upload.bindingId]: {
          principalId: principal.id,
          revision: upload.consentRevision
        }
      }
      // Never persist raw member IDs, credentials, or client-only fields in aggregate sources.
      state.records[eventKey] = {
        guildRef,
        season: upload.season,
        damageDealt: authoritative.damageDealt,
        damageType: authoritative.damageType,
        authorityDigest,
        checkedAt,
        attributions
      }
      return {
        index,
        status: duplicate ? 'duplicate' : 'verified',
        authorityDigest
      }
    })
    const response = receipt({
      version: 1,
      requestId: upload.requestId,
      consentRevision: upload.consentRevision,
      checkedAt,
      source: 'official-guild-raid',
      results
    })
    state.requests[requestKey] = {
      principalId: principal.id,
      bodyDigest,
      receipt: response,
      expiresAt: this.now() + 86400000
    }
    for (const [key, request] of Object.entries(state.requests))
      if (request.expiresAt < this.now()) delete state.requests[key]
    this.store.commit(state)
    return response
  }
  async revoke(principal, bindingId) {
    this.credentials.binding(principal, bindingId)
    await this.credentials.remove(principal, bindingId)
  }
  deleteContributions(principal, bindingId) {
    if (!principal?.authenticated) throw new Error('Authentication required')
    const state = structuredClone(this.store.value)
    for (const [key, row] of Object.entries(state.records)) {
      if (row.attributions[bindingId]?.principalId === principal.id)
        delete row.attributions[bindingId]
      if (Object.keys(row.attributions).length === 0) delete state.records[key]
    }
    for (const key of Object.keys(state.requests))
      if (
        key.startsWith(`${bindingId}/`) &&
        state.requests[key].principalId === principal.id
      )
        delete state.requests[key]
    this.store.commit(state)
    return { deletionId: randomUUID(), status: 'source-and-derived-recomputed' }
  }
  aggregate() {
    this.purgeRetention()
    const rows = Object.values(this.store.value.records).filter(
      (row) => this.now() - Date.parse(row.checkedAt) < 30 * 86400000
    )
    if (new Set(rows.map((row) => row.guildRef)).size < this.minimumGuilds)
      return { status: 'insufficient-cohort' }
    return {
      status: 'available',
      dataset: 'raid',
      source: 'official-guild-raid',
      samples: rows.length,
      totalDamage: rows.reduce((sum, row) => sum + row.damageDealt, 0),
      limitations:
        'Opt-in collectors; current membership and observable API fields only.'
    }
  }
  purgeRetention() {
    const state = structuredClone(this.store.value)
    for (const [key, row] of Object.entries(state.records))
      if (this.now() - Date.parse(row.checkedAt) >= 30 * 86400000)
        delete state.records[key]
    for (const [key, request] of Object.entries(state.requests))
      if (request.expiresAt <= this.now()) delete state.requests[key]
    for (const [key, rate] of Object.entries(state.rates ?? {}))
      if (this.now() - rate.from >= 60000) delete state.rates[key]
    this.store.commit(state)
    this.credentials.purgeExpired?.()
  }
}
