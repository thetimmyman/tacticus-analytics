// Whether the health surfaces run against a self-hosted stack, where the Docker,
// nginx, tunnel and backup probes and the extreme-memory auto-shutdown apply.
// Deployments opt in by flag; addresses count only through INTERNAL_NETWORK_CIDR.

export type DeploymentEnvSource = {
  DEPLOYMENT_ENV?: string
  SELF_HOSTED?: string
  INTERNAL_NETWORK_CIDR?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
}

export const SELF_HOSTED_DEPLOYMENT_ENV = 'self-hosted'

function ipv4ToInt(address: string): number | null {
  const octets = address.split('.')
  if (octets.length !== 4) return null
  let value = 0
  for (const octet of octets) {
    if (!/^\d{1,3}$/u.test(octet)) return null
    const n = Number(octet)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value
}

/** An unparseable CIDR matches nothing: a typo must never widen the match. */
export function isIpv4InCidr(address: string, cidr: string): boolean {
  const [network, prefixText, ...rest] = cidr.trim().split('/')
  if (network === undefined || prefixText === undefined || rest.length > 0) {
    return false
  }
  if (!/^\d{1,2}$/u.test(prefixText)) return false
  const prefix = Number(prefixText)
  if (prefix > 32) return false

  const networkInt = ipv4ToInt(network)
  const addressInt = ipv4ToInt(address)
  if (networkInt === null || addressInt === null) return false

  if (prefix === 0) return true
  // `<<` is a signed 32-bit op in JS, so normalise with >>> 0.
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return (networkInt & mask) >>> 0 === (addressInt & mask) >>> 0
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** `cidrList` is comma-separated; an empty or absent list matches nothing. */
export function isUrlHostInCidrs(
  url: string | undefined,
  cidrList: string | undefined
): boolean {
  const host = hostOf(url)
  if (!host || !cidrList) return false
  return cidrList
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((cidr) => isIpv4InCidr(host, cidr))
}

export function isLoopbackSupabaseUrl(url: string | undefined): boolean {
  const host = hostOf(url)
  if (!host) return false
  // URL.hostname keeps the brackets around an IPv6 literal.
  const bare = host.replace(/^\[|\]$/gu, '')
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1'
}

// Each variable is named statically: Next.js inlines only static NEXT_PUBLIC_*
// reads and the env-contract check only recognises static references.
function defaultEnv(): DeploymentEnvSource {
  return {
    DEPLOYMENT_ENV: process.env.DEPLOYMENT_ENV,
    SELF_HOSTED: process.env.SELF_HOSTED,
    INTERNAL_NETWORK_CIDR: process.env.INTERNAL_NETWORK_CIDR,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
  }
}

/** The explicit operator opt-in only; the Supabase URL is not consulted. */
export function isSelfHostedDeployment(
  env: DeploymentEnvSource = defaultEnv()
): boolean {
  return (
    env.DEPLOYMENT_ENV === SELF_HOSTED_DEPLOYMENT_ENV ||
    env.SELF_HOSTED === 'true'
  )
}

/** The opt-in, a loopback Supabase URL, or one inside INTERNAL_NETWORK_CIDR. */
export function isSelfHostedOrLocalDeployment(
  env: DeploymentEnvSource = defaultEnv()
): boolean {
  return (
    isSelfHostedDeployment(env) ||
    isLoopbackSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL) ||
    isUrlHostInCidrs(env.NEXT_PUBLIC_SUPABASE_URL, env.INTERNAL_NETWORK_CIDR)
  )
}
