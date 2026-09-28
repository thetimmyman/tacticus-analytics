// User workers run on a sandboxed filesystem that cannot see the ConfigMap mount, so the main
// service reads the override here and hands the bytes over in an env var instead.

export const OVERRIDE_DIR_ENV = 'LOKI_CONFIG_OVERRIDE_DIR'
export const OVERRIDE_FILENAME = 'GlobalConfig.json.gz'
export const OVERRIDE_BYTES_ENV = 'LOKI_CONFIG_OVERRIDE_GZ_BASE64'

const CACHE_TTL_MS = 60 * 1000
const BINARY_CHUNK_BYTES = 0x8000

export const decodeBase64 = (encoded: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK_BYTES) {
    // Chunked so a ~200 KB payload does not overflow the call-stack argument limit.
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + BINARY_CHUNK_BYTES))
    )
  }
  return btoa(binary)
}

interface HandoffCacheEntry {
  expiresAt: number
  entries: Array<[string, string]>
}

const cache = new Map<string, HandoffCacheEntry>()

export const overrideHandoffEnv = async (
  dir: string | undefined = Deno.env.get(OVERRIDE_DIR_ENV),
  now: number = Date.now()
): Promise<Array<[string, string]>> => {
  if (!dir) return []

  const cached = cache.get(dir)
  if (cached && cached.expiresAt > now) {
    return cached.entries
  }

  let entries: Array<[string, string]> = []
  try {
    const bytes = await Deno.readFile(`${dir}/${OVERRIDE_FILENAME}`)
    entries = [[OVERRIDE_BYTES_ENV, encodeBase64(bytes)]]
  } catch (error) {
    console.warn('[loki-config-override] main service cannot read override', {
      overrideDir: dir,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  cache.set(dir, { expiresAt: now + CACHE_TTL_MS, entries })
  return entries
}
