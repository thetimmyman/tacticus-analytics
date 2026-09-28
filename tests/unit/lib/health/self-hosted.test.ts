import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  isIpv4InCidr,
  isLoopbackSupabaseUrl,
  isSelfHostedDeployment,
  isSelfHostedOrLocalDeployment,
  isUrlHostInCidrs,
  SELF_HOSTED_DEPLOYMENT_ENV
} from '@/app/lib/health/self-hosted'

// Retired literals, assembled at runtime so this file does not carry them.
const RETIRED_ENV_VALUE = ['mini', 'pc'].join('')
const RETIRED_ADDRESS_PREFIX = ['192', '168', ''].join('.')

describe('SELF_HOSTED_DEPLOYMENT_ENV', () => {
  it('is the neutral value', () => {
    expect(SELF_HOSTED_DEPLOYMENT_ENV).toBe('self-hosted')
  })
})

describe('isSelfHostedDeployment', () => {
  it('accepts the neutral DEPLOYMENT_ENV value', () => {
    expect(isSelfHostedDeployment({ DEPLOYMENT_ENV: 'self-hosted' })).toBe(true)
  })

  it('still accepts SELF_HOSTED=true', () => {
    expect(isSelfHostedDeployment({ SELF_HOSTED: 'true' })).toBe(true)
  })

  it('rejects the retired deployment-specific DEPLOYMENT_ENV value', () => {
    expect(isSelfHostedDeployment({ DEPLOYMENT_ENV: RETIRED_ENV_VALUE })).toBe(
      false
    )
  })

  it('rejects anything else', () => {
    expect(isSelfHostedDeployment({ DEPLOYMENT_ENV: 'production' })).toBe(false)
    expect(isSelfHostedDeployment({})).toBe(false)
    expect(isSelfHostedDeployment({ SELF_HOSTED: 'false' })).toBe(false)
  })

  it('ignores the Supabase URL entirely', () => {
    expect(
      isSelfHostedDeployment({
        NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
        INTERNAL_NETWORK_CIDR: '10.0.0.0/8'
      })
    ).toBe(false)
  })
})

describe('isIpv4InCidr', () => {
  it('matches inside the block', () => {
    expect(isIpv4InCidr('10.4.5.6', '10.0.0.0/8')).toBe(true)
    expect(isIpv4InCidr('172.20.0.1', '172.16.0.0/12')).toBe(true)
    expect(isIpv4InCidr('10.0.0.1', '10.0.0.1/32')).toBe(true)
  })

  it('does not match outside the block', () => {
    expect(isIpv4InCidr('11.4.5.6', '10.0.0.0/8')).toBe(false)
    expect(isIpv4InCidr('172.32.0.1', '172.16.0.0/12')).toBe(false)
    expect(isIpv4InCidr('10.0.0.2', '10.0.0.1/32')).toBe(false)
  })

  it('handles /0 and high-bit addresses without sign overflow', () => {
    expect(isIpv4InCidr('203.0.113.9', '0.0.0.0/0')).toBe(true)
    expect(isIpv4InCidr('200.0.0.1', '200.0.0.0/24')).toBe(true)
    expect(isIpv4InCidr('255.255.255.255', '255.255.255.0/24')).toBe(true)
  })

  it('refuses to widen the match on unparseable input', () => {
    expect(isIpv4InCidr('10.0.0.1', '10.0.0.0')).toBe(false)
    expect(isIpv4InCidr('10.0.0.1', '10.0.0.0/33')).toBe(false)
    expect(isIpv4InCidr('10.0.0.1', '10.0.0.0/abc')).toBe(false)
    expect(isIpv4InCidr('203.0.113.9', '10.0.0.0/')).toBe(false)
    expect(isIpv4InCidr('203.0.113.9', '10.0.0.0/ ')).toBe(false)
    expect(isIpv4InCidr('203.0.113.9', '10.0.0.0/8/1')).toBe(false)
    expect(isIpv4InCidr('203.0.113.9', '10.0.0.0/-0')).toBe(false)
    expect(isIpv4InCidr('203.0.113.9', 'garbage/0')).toBe(false)
    expect(isIpv4InCidr('not-an-ip', '0.0.0.0/0')).toBe(false)
    expect(isIpv4InCidr('10.0.0.999', '10.0.0.0/8')).toBe(false)
    expect(isIpv4InCidr('not-an-ip', '10.0.0.0/8')).toBe(false)
    expect(isIpv4InCidr('10.0.1', '10.0.0.0/8')).toBe(false)
  })
})

describe('isUrlHostInCidrs', () => {
  it('matches a literal IPv4 host inside any listed block', () => {
    expect(
      isUrlHostInCidrs('http://10.1.2.3:8000', '172.16.0.0/12, 10.0.0.0/8')
    ).toBe(true)
  })

  it('does not match a hostname, only a literal address', () => {
    expect(isUrlHostInCidrs('https://api.example.com', '0.0.0.0/0')).toBe(false)
  })

  it('matches nothing when the list is absent or empty', () => {
    expect(isUrlHostInCidrs('http://10.1.2.3', undefined)).toBe(false)
    expect(isUrlHostInCidrs('http://10.1.2.3', '')).toBe(false)
    expect(isUrlHostInCidrs('http://10.1.2.3', ' , ')).toBe(false)
  })

  it('returns false rather than throwing on an unparseable URL', () => {
    expect(isUrlHostInCidrs('not a url', '10.0.0.0/8')).toBe(false)
    expect(isUrlHostInCidrs(undefined, '10.0.0.0/8')).toBe(false)
  })
})

describe('isLoopbackSupabaseUrl', () => {
  it('recognises loopback hosts', () => {
    expect(isLoopbackSupabaseUrl('http://localhost:54321')).toBe(true)
    expect(isLoopbackSupabaseUrl('http://127.0.0.1:54321')).toBe(true)
    expect(isLoopbackSupabaseUrl('http://[::1]:54321')).toBe(true)
  })

  it('does not treat a hostname merely containing "localhost" as loopback', () => {
    expect(isLoopbackSupabaseUrl('https://localhost.example.com')).toBe(false)
    expect(isLoopbackSupabaseUrl('https://api.example.com')).toBe(false)
    expect(isLoopbackSupabaseUrl(undefined)).toBe(false)
  })
})

describe('isSelfHostedOrLocalDeployment', () => {
  it('is true on the explicit flag', () => {
    expect(
      isSelfHostedOrLocalDeployment({ DEPLOYMENT_ENV: 'self-hosted' })
    ).toBe(true)
  })

  it('is true for a loopback Supabase URL with no flag set', () => {
    expect(
      isSelfHostedOrLocalDeployment({
        NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321'
      })
    ).toBe(true)
  })

  it('is false for a private-range Supabase URL when no CIDR is configured', () => {
    // The point of the change: no address range is assumed any more.
    expect(
      isSelfHostedOrLocalDeployment({
        NEXT_PUBLIC_SUPABASE_URL: `http://${RETIRED_ADDRESS_PREFIX}1.50:8000`
      })
    ).toBe(false)
  })

  it('is true for that same URL once INTERNAL_NETWORK_CIDR covers it', () => {
    expect(
      isSelfHostedOrLocalDeployment({
        NEXT_PUBLIC_SUPABASE_URL: `http://${RETIRED_ADDRESS_PREFIX}1.50:8000`,
        INTERNAL_NETWORK_CIDR: `${RETIRED_ADDRESS_PREFIX}0.0/16`
      })
    ).toBe(true)
  })

  it('is false for a public Supabase URL with a CIDR configured', () => {
    expect(
      isSelfHostedOrLocalDeployment({
        NEXT_PUBLIC_SUPABASE_URL: 'https://api.tacticusanalytics.com',
        INTERNAL_NETWORK_CIDR: `${RETIRED_ADDRESS_PREFIX}0.0/16`
      })
    ).toBe(false)
  })

  it('is false on a bare cloud deployment', () => {
    expect(
      isSelfHostedOrLocalDeployment({
        DEPLOYMENT_ENV: 'production',
        NEXT_PUBLIC_SUPABASE_URL: 'https://api.tacticusanalytics.com'
      })
    ).toBe(false)
  })
})

// The retired deployment-specific literals must not return to the health sources.
describe('no deployment-specific literals remain in the health sources', () => {
  const files = [
    'app/api/health/route.ts',
    'app/lib/health/infrastructure-health.ts',
    'app/lib/health/self-hosted.ts'
  ]

  it.each(files)('%s carries neither retired literal', (relative) => {
    const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
    expect(source).not.toContain(RETIRED_ENV_VALUE)
    expect(source).not.toContain(RETIRED_ADDRESS_PREFIX)
  })
})
