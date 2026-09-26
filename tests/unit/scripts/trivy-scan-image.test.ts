/** Pinned version/checksums are repeated so a silent change fails here, not the production scan. */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '../../..')
const HELPER = join(REPO_ROOT, 'scripts/ci/trivy-scan-image.sh')
const WORKFLOW = join(REPO_ROOT, '.github/workflows/build-clean-image.yml')
const EDGE_WORKFLOW = join(
  REPO_ROOT,
  '.github/workflows/build-edge-runtime-image.yml'
)

const TRIVY_VERSION = '0.70.0'
const IMAGE_REF = `ghcr.io/example/app@sha256:${'d'.repeat(64)}`
const AMD64_SHA =
  '8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9'
const ARM64_SHA =
  '2f6bb988b553a1bbac6bdd1ce890f5e412439564e17522b88a4541b4f364fc8d'

let workDir: string
let binDir: string
let repoDir: string

function writeStub(name: string, body: string): void {
  const stubPath = join(binDir, name)
  writeFileSync(stubPath, body)
  chmodSync(stubPath, 0o755)
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'trivy-scan-'))
  binDir = join(workDir, 'bin')
  repoDir = join(workDir, 'repo')
  mkdirSync(binDir)
  mkdirSync(repoDir)
  writeFileSync(join(repoDir, '.trivyignore'), '# empty allowlist\n')

  writeStub(
    'uname',
    `#!/usr/bin/env bash
printf '%s\\n' "\${STUB_UNAME_M:-x86_64}"
`
  )
  writeStub(
    'curl',
    `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--output" ]]; then out="$arg"; fi
  prev="$arg"
  case "$arg" in
    http://*|https://*) url="$arg" ;;
  esac
done
printf '%s\\n' "$url" >> "\${STUB_CURL_URL_LOG:?}"
if [[ -n "$out" ]]; then printf '%s' "\${STUB_CURL_CONTENT:-fake-archive}" > "$out"; fi
exit "\${STUB_CURL_EXIT:-0}"
`
  )
  writeStub(
    'sha256sum',
    `#!/usr/bin/env bash
set -euo pipefail
captured="$(cat)"
printf '%s\\n' "$captured" >> "\${STUB_SHA_STDIN_LOG:?}"
exit "\${STUB_SHA_EXIT:-0}"
`
  )
  writeStub(
    'tar',
    `#!/usr/bin/env bash
set -euo pipefail
dest=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-C" ]]; then dest="$arg"; fi
  prev="$arg"
done
if [[ -n "$dest" ]]; then
  cat > "$dest/trivy" <<'STUB_TRIVY'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "\${STUB_TRIVY_LOG:?}"
exit "\${STUB_TRIVY_EXIT:-0}"
STUB_TRIVY
  chmod +x "$dest/trivy"
fi
exit "\${STUB_TAR_EXIT:-0}"
`
  )
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runHelper(
  options: {
    args?: string[]
    cwd?: string
    env?: Record<string, string>
  } = {}
): RunResult {
  const result = spawnSync('bash', [HELPER, ...(options.args ?? [IMAGE_REF])], {
    cwd: options.cwd ?? repoDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TMPDIR: workDir,
      STUB_UNAME_M: 'x86_64',
      STUB_CURL_URL_LOG: join(workDir, 'curl-urls.log'),
      STUB_SHA_STDIN_LOG: join(workDir, 'sha-stdin.log'),
      STUB_TRIVY_LOG: join(workDir, 'trivy-args.log'),
      ...options.env
    }
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

function trivyArgs(): string[] {
  return readFileSync(join(workDir, 'trivy-args.log'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
}

function trivyExitCode(): string | undefined {
  const args = trivyArgs()
  return args[args.indexOf('--exit-code') + 1]
}

describe('trivy-scan-image.sh', () => {
  it('downloads the pinned amd64 release, verifies its published checksum, and invokes Trivy with the agreed flags', () => {
    const result = runHelper()

    expect(result.status).toBe(0)
    expect(readFileSync(join(workDir, 'curl-urls.log'), 'utf8')).toContain(
      `https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz`
    )
    expect(readFileSync(join(workDir, 'sha-stdin.log'), 'utf8')).toContain(
      AMD64_SHA
    )
    expect(trivyArgs()).toEqual([
      'image',
      '--platform',
      'linux/amd64',
      '--severity',
      'CRITICAL',
      '--ignore-unfixed',
      '--ignorefile',
      '.trivyignore',
      '--exit-code',
      '1',
      IMAGE_REF
    ])
  })

  it('selects the arm64 official asset and checksum on aarch64', () => {
    const result = runHelper({ env: { STUB_UNAME_M: 'aarch64' } })

    expect(result.status).toBe(0)
    expect(readFileSync(join(workDir, 'curl-urls.log'), 'utf8')).toContain(
      `trivy_${TRIVY_VERSION}_Linux-ARM64.tar.gz`
    )
    expect(readFileSync(join(workDir, 'sha-stdin.log'), 'utf8')).toContain(
      ARM64_SHA
    )
    expect(trivyArgs()[trivyArgs().indexOf('--platform') + 1]).toBe(
      'linux/arm64'
    )
  })

  it('fails closed on an unsupported runner architecture before downloading', () => {
    const result = runHelper({ env: { STUB_UNAME_M: 'riscv64' } })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unsupported runner architecture')
    expect(() => readFileSync(join(workDir, 'curl-urls.log'), 'utf8')).toThrow()
  })

  it('enforces by default and only `warn` relaxes the scanner exit code', () => {
    expect(runHelper().status).toBe(0)
    expect(trivyExitCode()).toBe('1')

    rmSync(join(workDir, 'trivy-args.log'))
    expect(runHelper({ env: { TRIVY_ENFORCE: 'enforce' } }).status).toBe(0)
    expect(trivyExitCode()).toBe('1')

    rmSync(join(workDir, 'trivy-args.log'))
    expect(runHelper({ env: { TRIVY_ENFORCE: 'warn' } }).status).toBe(0)
    expect(trivyExitCode()).toBe('0')

    rmSync(join(workDir, 'trivy-args.log'))
    expect(runHelper({ env: { TRIVY_ENFORCE: 'nonsense' } }).status).toBe(0)
    expect(trivyExitCode()).toBe('1')
  })

  it('propagates a scanner failure in enforce mode', () => {
    const result = runHelper({ env: { STUB_TRIVY_EXIT: '1' } })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
    expect(result.stderr).toContain(IMAGE_REF)
  })

  it('fails closed on a scanner error even in warn mode', () => {
    const result = runHelper({
      env: { TRIVY_ENFORCE: 'warn', STUB_TRIVY_EXIT: '1' }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('fail closed')
  })

  it('fails closed when the release download fails', () => {
    const result = runHelper({ env: { STUB_CURL_EXIT: '1' } })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('failed to download')
    expect(() =>
      readFileSync(join(workDir, 'trivy-args.log'), 'utf8')
    ).toThrow()
  })

  it('fails closed when the release checksum does not verify', () => {
    const result = runHelper({ env: { STUB_SHA_EXIT: '1' } })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('checksum mismatch')
    expect(() =>
      readFileSync(join(workDir, 'trivy-args.log'), 'utf8')
    ).toThrow()
  })

  it('fails closed when the release archive cannot be extracted', () => {
    const result = runHelper({ env: { STUB_TAR_EXIT: '1' } })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('failed to extract')
  })

  it('refuses to scan when the committed allowlist is missing', () => {
    const bareDir = join(workDir, 'bare')
    mkdirSync(bareDir)
    const result = runHelper({ cwd: bareDir })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ignorefile')
  })

  it('rejects a missing image reference with a usage error', () => {
    const result = runHelper({ args: [] })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })

  it('refuses an option or mutable tag before downloading or scanning', () => {
    for (const ref of [
      '--help',
      'ghcr.io/example/app:latest',
      'ghcr.io/example/app@sha256:deadbeef'
    ]) {
      const result = runHelper({ args: [ref] })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('immutable image@sha256')
    }
    expect(() => readFileSync(join(workDir, 'curl-urls.log'), 'utf8')).toThrow()
    expect(() =>
      readFileSync(join(workDir, 'trivy-args.log'), 'utf8')
    ).toThrow()
  })
})

describe('build-clean-image.yml Actions policy compatibility', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')
  const edgeWorkflow = readFileSync(EDGE_WORKFLOW, 'utf8')

  it('includes anonymous action steps when collecting policy candidates', () => {
    const fixture =
      '      - uses: unapproved/action@v1\n        uses: actions/checkout@v4'
    const uses = [...fixture.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gmu)].map(
      (match) => match[1]
    )
    expect(uses).toEqual(['unapproved/action@v1', 'actions/checkout@v4'])
  })

  it('uses no disallowed action in either image publisher', () => {
    const uses = [
      ...`${workflow}\n${edgeWorkflow}`.matchAll(
        /^\s*(?:-\s+)?uses:\s*(\S+)/gmu
      )
    ].map((match) => match[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) {
      const owner = action.split('/')[0].toLowerCase()
      const allowed =
        owner === 'actions' ||
        owner === 'docker' ||
        action.startsWith('denoland/setup-deno@')
      expect(allowed, `disallowed action: ${action}`).toBe(true)
    }
    // Only `uses:` lines matter; comments may name the removed action.
    expect(uses.filter((action) => action.startsWith('aquasecurity/'))).toEqual(
      []
    )
  })

  it('runs both architecture scans through the helper against the pushed digest', () => {
    const helperCalls = [
      ...workflow.matchAll(
        /^\s*run:\s+scripts\/ci\/trivy-scan-image\.sh\s+"\$IMAGE_REF"\s*$/gmu
      )
    ]
    expect(helperCalls).toHaveLength(2)

    const digestRefs = [
      ...workflow.matchAll(
        /\$\{\{ env\.IMAGE \}\}@\$\{\{ steps\.build\.outputs\.digest \}\}/gmu
      )
    ]
    expect(digestRefs).toHaveLength(2)
  })

  it('resolves both edge arch tags to digests before using the same helper', () => {
    const archJobs = edgeWorkflow.split('\n  merge-manifest:')[0]
    expect([
      ...archJobs.matchAll(
        /scripts\/ci\/retry-imagetools-inspect\.sh "\$tagged_ref"/gmu
      )
    ]).toHaveLength(2)
    expect([
      ...archJobs.matchAll(
        /scripts\/ci\/trivy-scan-image\.sh "\$IMAGE@\$digest"/gmu
      )
    ]).toHaveLength(2)
    expect([
      ...archJobs.matchAll(/\^sha256:\[0-9a-f\]\{64\}\$/gmu)
    ]).toHaveLength(2)
  })
})
