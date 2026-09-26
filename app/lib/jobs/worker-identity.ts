// HOSTNAME alone is untrusted: the image sets HOSTNAME=0.0.0.0 so `next start` binds all interfaces.
import { randomUUID } from 'node:crypto'
import { hostname as getOsHostname } from 'node:os'

// Bind addresses, never a pod identity (trimmed, case-insensitive match).
const BIND_ADDRESS_SENTINELS = new Set([
  '0.0.0.0',
  '::',
  '[::]',
  '0000:0000:0000:0000:0000:0000:0000:0000',
  '127.0.0.1',
  'localhost'
])

function isUsablePodIdentity(
  value: string | undefined | null
): value is string {
  if (!value) return false
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  return !BIND_ADDRESS_SENTINELS.has(trimmed.toLowerCase())
}

// Each field overrides its env/os source; tests only.
export interface WorkerIdSources {
  podName?: string | undefined
  hostnameEnv?: string | undefined
  osHostname?: () => string
  uuid?: () => string
}

export function resolvePodIdentity(sources: WorkerIdSources = {}): string {
  const podName = sources.podName ?? process.env.POD_NAME
  const hostnameEnv = sources.hostnameEnv ?? process.env.HOSTNAME
  const readOsHostname = sources.osHostname ?? getOsHostname

  if (isUsablePodIdentity(podName)) return podName.trim()
  if (isUsablePodIdentity(hostnameEnv)) return hostnameEnv.trim()

  let kernelHostname: string | undefined
  try {
    kernelHostname = readOsHostname()
  } catch {
    kernelHostname = undefined
  }
  if (isUsablePodIdentity(kernelHostname)) return kernelHostname.trim()

  return 'local'
}

export function buildWorkerId(sources: WorkerIdSources = {}): string {
  const uuid = sources.uuid ?? randomUUID
  const identity = resolvePodIdentity(sources)
  return `${identity}-${uuid().slice(0, 8)}`
}
