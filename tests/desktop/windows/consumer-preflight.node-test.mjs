import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(
  new URL('./installed-journey.ps1', import.meta.url)
)

test(
  'consumer qualification refuses an unapproved invocation before creating an install or receipt',
  {
    skip: process.platform !== 'win32'
  },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'consumer qualification '))
    const bundle = join(root, 'missing candidate')
    const evidence = join(root, 'receipt.json')
    const qualification = join(root, 'must not be created')
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          script,
          '-Bundle',
          bundle,
          '-Evidence',
          evidence,
          '-QualificationRoot',
          qualification,
          '-StandardUser'
        ],
        { encoding: 'utf8', timeout: 30000 }
      )
      assert.ifError(result.error)
      assert.notEqual(result.status, 0)
      for (const path of [bundle, evidence, qualification])
        await assert.rejects(access(path), { code: 'ENOENT' })
      if (
        /running scripts is disabled/.test(result.stderr) &&
        /UnauthorizedAccess/.test(result.stderr)
      ) {
        context.skip(
          'Windows execution policy blocks the unsigned test script; admission logic was not exercised'
        )
        return
      }
      assert.match(
        result.stderr,
        /requires an interactive Windows desktop session|Sign in with a standard user account|Reviewed manifest digest and source commit are required/
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
