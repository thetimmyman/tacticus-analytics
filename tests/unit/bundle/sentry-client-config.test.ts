import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const readRootFile = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8')

describe('client Sentry bundle configuration', () => {
  it('uses instrumentation-client.ts as the only client init file', () => {
    expect(existsSync(path.join(repoRoot, 'instrumentation-client.ts'))).toBe(
      true
    )
    expect(existsSync(path.join(repoRoot, 'sentry.client.config.ts'))).toBe(
      false
    )
  })

  it('keeps Session Replay disabled and out of the client bundle', () => {
    const source = readRootFile('instrumentation-client.ts')

    expect(source).toContain('replaysSessionSampleRate: 0')
    expect(source).toContain('replaysOnErrorSampleRate: 0')
    expect(source).not.toContain('lazyLoadIntegration')
    expect(source).not.toContain('replayIntegration')
  })

  it('keeps browser envelopes on the monitoring tunnel with PII disabled', () => {
    const source = readRootFile('instrumentation-client.ts')

    expect(source).toContain("tunnel: '/monitoring'")
    expect(source).toContain('userInfo: false')
    expect(source).toContain('cookies: false')
    expect(source).toContain('httpBodies: []')
    expect(source).toContain('NEXT_PUBLIC_GLITCHTIP_DSN')
  })

  it('does not allow the retired Replay CDN through CSP', () => {
    const source = readRootFile('proxy.ts')

    expect(source).not.toContain('https://browser.sentry-cdn.com')
  })
})
