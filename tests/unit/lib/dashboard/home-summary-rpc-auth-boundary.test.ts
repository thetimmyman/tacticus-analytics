import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('home RPC authorization boundary', () => {
  it('does not contain an empty-result service-role rehydration path', () => {
    const source = readFileSync('app/lib/dashboard/home-summary-rpc.ts', 'utf8')

    expect(source).toContain('HomeRpcAuthorizationDenied')
    expect(source).not.toContain('home-rpc.getTokenUsage.service')
    expect(source).not.toContain('if (!tokenUsage || tokenUsage.length === 0)')
  })
})
