import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Actions may not create PRs here, so that refusal is non-fatal; any other `gh` failure fails.

const scriptPath = 'scripts/ci/stamp-pin-open-pr.sh'
const read = (path: string) => readFileSync(path, 'utf8')

const REFUSAL_TEXT =
  'GitHub Actions is not permitted to create or approve pull requests'

function withStubGh(script: string, run: (stubDir: string) => void) {
  const stubDir = mkdtempSync(join(tmpdir(), 'stamp-pin-stub-gh-'))
  const stubPath = join(stubDir, 'gh')
  try {
    writeFileSync(stubPath, script)
    chmodSync(stubPath, 0o755)
    run(stubDir)
  } finally {
    rmSync(stubDir, { recursive: true, force: true })
  }
}

function runScript(stubDir: string, extraEnv: Record<string, string> = {}) {
  return execFileSync(scriptPath, [], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      BRANCH: 'ci/stamp-tacticus-pin-abc12345',
      PR_TITLE: 'chore(PS-539): stamp tacticus pin at abc12345',
      PR_BODY: 'Automated pin stamp for namespace tacticus from this build.',
      GITHUB_REPOSITORY: 'thetimmyman/tacticus-analytics',
      GH_TOKEN: 'not-a-real-token',
      ...extraEnv
    }
  })
}

describe('stamp-pin-open-pr.sh', () => {
  it('exits 0 and prints the branch + compare URL when gh refuses to create the PR', () => {
    withStubGh(
      `#!/usr/bin/env bash\necho "pull request create failed: GraphQL: ${REFUSAL_TEXT}. (createPullRequest)" >&2\nexit 1\n`,
      (stubDir) => {
        const summaryPath = join(stubDir, 'summary.md')
        writeFileSync(summaryPath, '')
        const output = runScript(stubDir, {
          GITHUB_STEP_SUMMARY: summaryPath
        })

        expect(output).toContain('::notice::')
        expect(output).toContain(REFUSAL_TEXT)
        expect(output).toContain('Branch: ci/stamp-tacticus-pin-abc12345')
        expect(output).toContain(
          'Compare: https://github.com/thetimmyman/tacticus-analytics/compare/main...ci/stamp-tacticus-pin-abc12345?expand=1'
        )

        const summary = read(summaryPath)
        expect(summary).toContain(REFUSAL_TEXT)
        expect(summary).toContain('ci/stamp-tacticus-pin-abc12345')
        expect(summary).toContain(
          'https://github.com/thetimmyman/tacticus-analytics/compare/main...ci/stamp-tacticus-pin-abc12345?expand=1'
        )
      }
    )
  })

  it('still fails the step for a gh error that is not the known refusal', () => {
    withStubGh(
      '#!/usr/bin/env bash\necho "error connecting to api.github.com: dial tcp: lookup api.github.com: no such host" >&2\nexit 1\n',
      (stubDir) => {
        let threw = false
        try {
          runScript(stubDir)
        } catch (error) {
          threw = true
          const typed = error as {
            status?: number
            stdout?: Buffer | string
            stderr?: Buffer | string
          }
          const stdout = String(typed.stdout ?? '')
          const stderr = String(typed.stderr ?? '')

          expect(typed.status).not.toBe(0)
          expect(stdout).toContain('::error::')
          expect(stdout).not.toContain(REFUSAL_TEXT)
          expect(stderr).toContain('api.github.com')
        }
        expect(threw).toBe(true)
      }
    )
  })

  it('passes through gh output and exits 0 on a successful PR create', () => {
    withStubGh(
      '#!/usr/bin/env bash\necho "https://github.com/thetimmyman/tacticus-analytics/pull/999"\nexit 0\n',
      (stubDir) => {
        const output = runScript(stubDir)
        expect(output).toContain(
          'https://github.com/thetimmyman/tacticus-analytics/pull/999'
        )
      }
    )
  })

  it('keeps the "Pin already up to date" short-circuit inline and unchanged, and delegates PR creation to the script', () => {
    const workflow = read('.github/workflows/build-edge-runtime-image.yml')

    expect(workflow).toContain(
      'if git diff --quiet -- deploy/tacticus.pin.json; then'
    )
    expect(workflow).toContain(
      'echo "Pin already up to date at $commit; nothing to do."'
    )
    expect(workflow).toContain('exit 0')

    expect(workflow).toContain('scripts/ci/stamp-pin-open-pr.sh')
    expect(workflow).not.toContain(
      'GitHub Actions is not permitted to create or approve pull requests'
    )
  })
})
