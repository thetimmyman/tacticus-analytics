import { randomBytes } from 'node:crypto'
import {
  brokerRequestSchema,
  brokerUnavailableSchema,
  type AddonId,
  type Platform
} from './contract'

type Reason =
  | 'protocol-unapproved'
  | 'permission-refused'
  | 'vault-locked'
  | 'vault-unavailable'
  | 'binding-changed'
  | 'revoked'
  | 'expired'
  | 'addon-disabled'
  | 'cancelled'
type Lease = {
  addonId: AddonId
  session: string
  expiresAt: number
  consent: boolean
}
export class BrokerError extends Error {
  constructor() {
    super('Invalid device operation request')
    this.name = 'BrokerError'
  }
}

/** Native adapters must implement approved operations before this gate can open. */
export class DeviceBroker {
  private leases = new Map<string, Lease>()
  private vault: 'available' | 'locked' | 'unavailable' = 'unavailable'
  private stopped: Reason = 'revoked'
  private stoppedByAddon = new Map<AddonId, Reason>()
  constructor(
    private readonly platform: Platform,
    private readonly currentSession: (
      handle: string,
      addon: AddonId
    ) => boolean,
    private readonly now: () => number = Date.now
  ) {}
  setVault(status: 'available' | 'locked' | 'unavailable') {
    if (!['available', 'locked', 'unavailable'].includes(status))
      throw new BrokerError()
    this.vault = status
    if (status !== 'available')
      this.invalidate(
        status === 'locked' ? 'vault-locked' : 'vault-unavailable'
      )
  }
  /** Trusted native caller only. This handle does not assert connected availability. */
  lease(addon: AddonId, session: string, consent: boolean): string {
    if (this.vault !== 'available') throw new BrokerError()
    if (
      !['guild-war', 'replays'].includes(addon) ||
      typeof consent !== 'boolean' ||
      !this.currentSession(session, addon)
    )
      throw new BrokerError()
    if (this.leases.size >= 32) this.invalidate('expired')
    for (const [handle, existing] of this.leases)
      if (existing.addonId === addon && existing.session === session)
        this.leases.delete(handle)
    const handle = randomBytes(24).toString('hex')
    this.leases.set(handle, {
      addonId: addon,
      session,
      expiresAt: this.now() + 60_000,
      consent
    })
    return handle
  }
  request(input: unknown) {
    const parsed = brokerRequestSchema.safeParse(input)
    if (!parsed.success) throw new BrokerError()
    const request = parsed.data,
      lease = this.leases.get(request.leaseHandle)
    let reason: Reason = 'protocol-unapproved'
    if (!lease)
      reason = this.stoppedByAddon.get(request.addonId) ?? this.stopped
    else if (
      lease.addonId !== request.addonId ||
      lease.session !== request.sessionHandle
    )
      throw new BrokerError()
    else if (!this.currentSession(lease.session, lease.addonId)) {
      this.leases.delete(request.leaseHandle)
      reason = 'binding-changed'
    } else if (lease.expiresAt <= this.now()) {
      this.leases.delete(request.leaseHandle)
      reason = 'expired'
    } else if (!lease.consent) {
      this.leases.delete(request.leaseHandle)
      reason = 'permission-refused'
    } else if (this.vault !== 'available')
      reason = this.vault === 'locked' ? 'vault-locked' : 'vault-unavailable'
    // There is no game-client discovery, secret input, network or signing implementation here.
    return brokerUnavailableSchema.parse({
      schemaVersion: 1,
      status: 'unavailable',
      reason,
      alternative:
        reason === 'vault-locked'
          ? 'unlock-vault'
          : reason === 'binding-changed' || reason === 'expired'
            ? 'reconnect-account'
            : request.addonId === 'guild-war'
              ? 'import-war-json'
              : 'import-replay-json'
    })
  }
  /**
   * Without a scope every lease is revoked (vault, binding). With an add-on scope only that
   * add-on's leases are revoked, so module lifecycle events do not disturb the other module.
   */
  invalidate(reason: Reason = 'revoked', addon?: AddonId) {
    if (addon === undefined) {
      this.leases.clear()
      this.stoppedByAddon.clear()
      this.stopped = reason
      return
    }
    for (const [handle, lease] of this.leases)
      if (lease.addonId === addon) this.leases.delete(handle)
    this.stoppedByAddon.set(addon, reason)
  }
  support() {
    return {
      platform: this.platform,
      connected: false as const,
      method: 'none-approved' as const,
      secretPersistence: false as const,
      alternatives: [
        'local-war-json',
        'local-replay-json',
        'separate-official-api-onboarding'
      ] as const
    }
  }
}
