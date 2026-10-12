import { createPublicKey } from 'node:crypto'
import { z } from 'zod'
import { AddonHost, AddonError } from '../../packages/addon-host/src/host'
import { addonId, capability } from '../../packages/addon-host/src/contract'
import { createAddonCommands, type SaveLocalData } from './commands'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const policySchema = z
  .object({
    schemaVersion: z.literal(1),
    coreVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    trustedKeys: z.record(
      z.string().regex(/^[a-z0-9-]{1,64}$/),
      z.string().max(4096)
    ),
    revokedKeyIds: z.array(z.string().max(64)).max(100),
    approvedReviews: z.array(digest).max(100),
    approvedRightsReceipts: z.array(digest).max(100)
  })
  .strict()
const requests = z.discriminatedUnion('method', [
  z.object({ method: z.literal('list'), args: z.tuple([]) }).strict(),
  z
    .object({
      method: z.literal('stagePackage'),
      args: z.tuple([z.string().max(12_582_912)])
    })
    .strict(),
  z
    .object({
      method: z.literal('activate'),
      args: z.tuple([digest, z.array(capability).max(4)])
    })
    .strict(),
  z
    .object({
      method: z.literal('setEnabled'),
      args: z.tuple([addonId, z.boolean()])
    })
    .strict(),
  z
    .object({ method: z.literal('rollback'), args: z.tuple([addonId]) })
    .strict(),
  z
    .object({
      method: z.literal('uninstall'),
      args: z.tuple([addonId, z.enum(['retain', 'delete'])])
    })
    .strict(),
  z
    .object({
      method: z.literal('importLocalData'),
      args: z.tuple([addonId, z.string().max(2_097_152)])
    })
    .strict(),
  z.object({ method: z.literal('view'), args: z.tuple([addonId]) }).strict(),
  z
    .object({ method: z.literal('exportLocalData'), args: z.tuple([addonId]) })
    .strict()
])

/** Main-process adapter. No filesystem paths, credentials or broker calls are renderer inputs. */
export function createNativeAddonRuntime(root: string, rawPolicy: unknown) {
  const policy = policySchema.parse(rawPolicy)
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch))
    throw new AddonError('incompatible-package')
  const host = new AddonHost(root, {
    ...policy,
    platform: 'linux',
    architecture: process.arch as 'x64' | 'arm64',
    trustedKeys: new Map(
      Object.entries(policy.trustedKeys).map(([id, pem]) => {
        const key = createPublicKey(pem)
        if (key.asymmetricKeyType !== 'ed25519')
          throw new AddonError('untrusted-package')
        return [id, key]
      })
    ),
    revokedKeyIds: new Set(policy.revokedKeyIds),
    approvedReviews: new Set(policy.approvedReviews),
    approvedRightsReceipts: new Set(policy.approvedRightsReceipts)
  })
  const commands = createAddonCommands(host)
  return {
    setBinding: host.setBinding.bind(host),
    async dispatch(input: unknown, saveLocalData?: SaveLocalData) {
      const request = requests.parse(input)
      // Explicit dispatch keeps the public bridge smaller than the host implementation.
      switch (request.method) {
        case 'list':
          return commands.list()
        case 'stagePackage':
          return commands.stagePackage(...request.args)
        case 'activate':
          return commands.activate(...request.args)
        case 'setEnabled':
          return commands.setEnabled(...request.args)
        case 'rollback':
          return commands.rollback(...request.args)
        case 'uninstall':
          return commands.uninstall(...request.args)
        case 'importLocalData':
          return commands.importLocalData(...request.args)
        case 'view':
          return commands.view(...request.args)
        case 'exportLocalData':
          return createAddonCommands(host, saveLocalData).exportLocalData(
            ...request.args
          )
      }
    }
  }
}
