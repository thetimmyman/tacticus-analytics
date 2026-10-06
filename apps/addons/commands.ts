import { z } from 'zod'
import {
  addonId,
  capability,
  type AddonId,
  type AddonManifest
} from '../../packages/addon-host/src/contract'
import {
  AddonError,
  type AddonHost,
  type AddonSummary
} from '../../packages/addon-host/src/host'
import {
  summarizeWar,
  type ReplayTimeline
} from '../../packages/addon-host/src/offline'

export type ModuleView =
  | { addonId: 'guild-war'; report: ReturnType<typeof summarizeWar> }
  | { addonId: 'replays'; replay: ReplayTimeline }
export type AddonCommands = {
  list(): Promise<AddonSummary[]>
  stagePackage(
    json: string
  ): Promise<{ digest: string; manifest: AddonManifest }>
  activate(
    digest: string,
    approvals: AddonManifest['capabilities']
  ): Promise<void>
  setEnabled(id: AddonId, enabled: boolean): Promise<void>
  rollback(id: AddonId): Promise<void>
  uninstall(id: AddonId, dataChoice: 'retain' | 'delete'): Promise<void>
  importLocalData(id: AddonId, json: string): Promise<void>
  view(id: AddonId): Promise<ModuleView>
}

/** Mount behind native authenticated IPC. Do not expose a loopback HTTP endpoint. */
export function createAddonCommands(host: AddonHost): AddonCommands {
  function withSession<T>(id: AddonId, work: (handle: string) => T): T {
    const handle = host.openSession(addonId.parse(id))
    try {
      return work(handle)
    } finally {
      host.closeSession(handle)
    }
  }
  return {
    async list() {
      return host.list()
    },
    async stagePackage(json) {
      if (typeof json !== 'string' || Buffer.byteLength(json) > 12_582_912)
        throw new AddonError('invalid-package')
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch {
        throw new AddonError('invalid-package')
      }
      return host.stage(parsed)
    },
    async activate(digest, approvals) {
      host.activate(
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(digest),
        z.array(capability).max(4).parse(approvals)
      )
    },
    async setEnabled(id, enabled) {
      host.setEnabled(addonId.parse(id), z.boolean().parse(enabled))
    },
    async rollback(id) {
      host.rollback(addonId.parse(id))
    },
    async uninstall(id, choice) {
      host.uninstall(
        addonId.parse(id),
        z.enum(['retain', 'delete']).parse(choice)
      )
    },
    async importLocalData(id, json) {
      withSession(id, (handle) =>
        host.importData(handle, z.string().max(2_097_152).parse(json))
      )
    },
    async view(id) {
      const parsedId = addonId.parse(id),
        data = withSession(parsedId, (handle) => host.readData(handle))
      if (parsedId === 'guild-war' && data.format === 'ta-war-summary-v1')
        return { addonId: 'guild-war', report: summarizeWar(data) }
      if (parsedId === 'replays' && data.format === 'ta-replay-timeline-v1')
        return { addonId: 'replays', replay: data }
      throw new AddonError('no-local-data')
    }
  }
}
