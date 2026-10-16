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

// Windows PowerShell must construct its own module path when Node inherits
// PowerShell 7's environment; those modules can break legacy cmdlet autoloading.
const powerShellEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name.toLowerCase() !== 'psmodulepath'
  )
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
        { encoding: 'utf8', timeout: 30000, env: powerShellEnvironment }
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

test(
  'trusted consumer preflight logic rejects synthetic privileged identities and changed payloads while accepting equivalent installed manifests',
  { skip: process.platform !== 'win32' },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'consumer preflight logic '))
    try {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          fileURLToPath(
            new URL('./consumer-preflight-proof.ps1', import.meta.url)
          ),
          '-Root',
          root
        ],
        { encoding: 'utf8', timeout: 30000, env: powerShellEnvironment }
      )
      assert.ifError(result.error)
      if (
        /running scripts is disabled/.test(result.stderr) &&
        /UnauthorizedAccess/.test(result.stderr)
      ) {
        context.skip(
          'Windows execution policy blocks the unsigned logic test script; controls were not exercised'
        )
        return
      }
      assert.equal(result.status, 0, result.stderr)
      const receipt = JSON.parse(result.stdout.trim())
      assert.equal(receipt.completed, true)
      assert.equal(receipt.assertions, 9)
      assert.equal(receipt.nativeStandardUser, false)
      assert.equal(receipt.candidateExecuted, false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
