import { randomUUID } from 'node:crypto'
import { consent, envelope, allowed, receipt } from './contract.mjs'
import { AtomicState } from './storage.mjs'

function policyKey(policy) {
  return `${policy.accountRef}/${policy.guildId}/${policy.purpose}`
}

export class ContributionQueue {
  #inflight = new Map()
  #draining = false
  constructor({
    path,
    now = () => Date.now(),
    maxJobs = 100,
    maxAgeMs = 7 * 86400000
  }) {
    this.store = new AtomicState(path, {
      version: 1,
      policies: {},
      jobs: [],
      receipts: []
    })
    this.now = now
    this.maxJobs = maxJobs
    this.maxAgeMs = maxAgeMs
    if (this.store.value.version !== 1)
      throw new Error('Unsupported queue version')
    Object.values(this.store.value.policies).forEach(consent)
    this.store.value.jobs.forEach((job) => envelope(job.upload))
  }
  policies() {
    return structuredClone(Object.values(this.store.value.policies))
  }
  setPolicy(input) {
    const policy = consent(input),
      state = structuredClone(this.store.value),
      key = policyKey(policy)
    const old = state.policies[key]
    if (old && policy.revision <= old.revision)
      throw new Error('Consent revision must increase')
    state.policies[key] = policy
    state.jobs = state.jobs.filter(
      (job) => job.policyKey !== key || allowed(policy, job.upload)
    )
    this.store.commit(state)
    for (const flight of this.#inflight.values())
      if (flight.policyKey === key) flight.controller.abort()
    return policy
  }
  preview(input) {
    return envelope(input)
  }
  enqueue(accountRef, input) {
    const upload = envelope(input),
      key = policyKey({ accountRef, ...upload }),
      state = structuredClone(this.store.value)
    const policy = state.policies[key]
    if (!policy || !allowed(policy, upload))
      throw new Error('Contribution consent is not active')
    state.jobs = state.jobs.filter(
      (job) => this.now() - job.createdAt <= this.maxAgeMs
    )
    if (state.jobs.some((job) => job.upload.requestId === upload.requestId))
      throw new Error('Duplicate request')
    if (state.jobs.length >= this.maxJobs)
      throw new Error('Contribution queue is full')
    state.jobs.push({
      policyKey: key,
      upload,
      attempts: 0,
      nextAt: this.now(),
      createdAt: this.now()
    })
    this.store.commit(state)
  }
  inspect() {
    return {
      pending: this.store.value.jobs.map((job) => ({
        requestId: job.upload.requestId,
        purpose: job.upload.purpose,
        dataset: job.upload.dataset,
        rows: job.upload.rows.length,
        attempts: job.attempts
      })),
      receipts: structuredClone(this.store.value.receipts)
    }
  }
  async drain(send) {
    if (this.#draining) throw new Error('Contribution queue is already sending')
    this.#draining = true
    try {
      for (const job of structuredClone(this.store.value.jobs)) {
        let state = this.store.value,
          policy = state.policies[job.policyKey]
        if (
          this.now() - job.createdAt > this.maxAgeMs ||
          !policy ||
          !allowed(policy, job.upload)
        ) {
          this.store.commit({
            ...state,
            jobs: state.jobs.filter(
              (item) => item.upload.requestId !== job.upload.requestId
            )
          })
          continue
        }
        if (job.nextAt > this.now()) continue
        const controller = new AbortController()
        this.#inflight.set(job.upload.requestId, {
          policyKey: job.policyKey,
          controller
        })
        try {
          const response = receipt(
            await send(structuredClone(job.upload), {
              signal: controller.signal
            })
          )
          if (
            response.requestId !== job.upload.requestId ||
            response.consentRevision !== job.upload.consentRevision ||
            response.results.some(
              (result) => result.index >= job.upload.rows.length
            ) ||
            new Set(response.results.map((result) => result.index)).size !==
              response.results.length
          )
            throw new Error('Unmatched receipt')
          state = structuredClone(this.store.value)
          policy = state.policies[job.policyKey]
          const revoked = !policy || !allowed(policy, job.upload)
          state.receipts.push({
            ...response,
            delivery: revoked ? 'sent-before-revocation' : 'received'
          })
          state.receipts = state.receipts.slice(-100)
          state.jobs = state.jobs.filter(
            (item) => item.upload.requestId !== job.upload.requestId
          )
          if (!revoked) {
            const accepted = new Map(
              response.results.map((result) => [result.index, result.status])
            )
            const rows = job.upload.rows.filter(
              (_, index) =>
                !accepted.has(index) || accepted.get(index) === 'pending'
            )
            if (rows.length)
              state.jobs.push({
                ...job,
                upload: { ...job.upload, requestId: randomUUID(), rows },
                attempts: job.attempts + 1,
                nextAt:
                  this.now() +
                  Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12))
              })
          }
          this.store.commit(state)
        } catch {
          state = structuredClone(this.store.value)
          const current = state.jobs.find(
            (item) => item.upload.requestId === job.upload.requestId
          )
          if (current) {
            current.attempts++
            current.nextAt =
              this.now() +
              Math.min(3600000, 1000 * 2 ** Math.min(current.attempts, 12))
            this.store.commit(state)
          }
        } finally {
          this.#inflight.delete(job.upload.requestId)
        }
      }
    } finally {
      this.#draining = false
    }
  }
}
