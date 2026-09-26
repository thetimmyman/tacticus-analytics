import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The orchestrator runs with VERIFY_JWT=false, so it enforces service-role itself.

const SERVICE_KEY = 'service-role-key-abc123'

type DenoLike = { env: { get: (k: string) => string | undefined } }

function setServiceKey(value: string | undefined) {
  ;(globalThis as unknown as { Deno: DenoLike }).Deno = {
    env: {
      get: (key: string) =>
        key === 'SUPABASE_SERVICE_ROLE_KEY' ? value : undefined
    }
  }
}

// Import after the Deno stub; the helper reads env at call time.
async function loadGuard() {
  const mod = await import('../../../supabase/functions/_shared/auth-guard.ts')
  return mod.requireServiceRole as (req: Request) => Response | null
}

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://internal/functions/v1/sync-modular-workflow', {
    method: 'POST',
    headers
  })
}

describe('requireServiceRole (edge auth guard)', () => {
  let originalDeno: unknown

  beforeEach(() => {
    originalDeno = (globalThis as Record<string, unknown>).Deno
    setServiceKey(SERVICE_KEY)
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).Deno = originalDeno
  })

  it('authorizes a Bearer token equal to the service-role key', async () => {
    const requireServiceRole = await loadGuard()
    const result = requireServiceRole(
      reqWith({ Authorization: `Bearer ${SERVICE_KEY}` })
    )
    expect(result).toBeNull()
  })

  it('authorizes when the apikey header equals the service-role key', async () => {
    const requireServiceRole = await loadGuard()
    const result = requireServiceRole(reqWith({ apikey: SERVICE_KEY }))
    expect(result).toBeNull()
  })

  it('is case-insensitive on the Bearer scheme', async () => {
    const requireServiceRole = await loadGuard()
    const result = requireServiceRole(
      reqWith({ Authorization: `bearer ${SERVICE_KEY}` })
    )
    expect(result).toBeNull()
  })

  it('rejects an anon-key Bearer token (the core defect: anon could trigger sync)', async () => {
    const requireServiceRole = await loadGuard()
    const result = requireServiceRole(
      reqWith({
        Authorization: 'Bearer anon-public-key',
        apikey: 'anon-public-key'
      })
    )
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })

  it('rejects a request with no credentials', async () => {
    const requireServiceRole = await loadGuard()
    const result = requireServiceRole(reqWith({}))
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })

  it('rejects (fails closed) when the service-role key is not configured', async () => {
    setServiceKey(undefined)
    const requireServiceRole = await loadGuard()
    const result = requireServiceRole(
      reqWith({ Authorization: `Bearer ${SERVICE_KEY}` })
    )
    expect(result).not.toBeNull()
    expect(result!.status).toBe(401)
  })
})
