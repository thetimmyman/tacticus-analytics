import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Runs each guard's built-in controls so CI fails if a guard stops biting.
const selftest = (script: string) =>
  execFileSync(process.execPath, [`scripts/security/${script}`, '--selftest'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

describe('repository guard self-tests', () => {
  it('comment hygiene controls pass', () => {
    expect(selftest('check-comment-hygiene.mjs')).toContain('controls passed')
  }, 60_000)

  it('real-identity controls pass', () => {
    expect(selftest('check-real-identities.mjs')).toContain('controls passed')
  }, 60_000)
})
