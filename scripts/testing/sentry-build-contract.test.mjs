import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const dockerfile = readFileSync(
  path.join(root, 'docker/Dockerfile.prod'),
  'utf8'
)
const instructions = dockerfile.replace(/\\\n/g, ' ').split('\n')
const build = instructions.find(
  (line) => line.startsWith('RUN ') && line.includes('verify-app-identity.mjs')
)
assert.ok(build, 'The production identity-and-build instruction must exist')
const base = instructions
  .find((line) => line.startsWith('FROM '))
  .split(/\s+/)[1]

function exercise({ upload = true, secret = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'source-map-build-'))
  const context = path.join(directory, 'context')
  const image = `source-map-build-test:${randomUUID()}`
  const sentinel = `synthetic-build-secret-${randomUUID()}`
  try {
    mkdirSync(path.join(context, 'scripts/dev'), { recursive: true })
    mkdirSync(path.join(context, 'node_modules/.bin'), { recursive: true })
    writeFileSync(
      path.join(context, 'scripts/dev/verify-app-identity.mjs'),
      'process.exit(0);\n'
    )
    writeFileSync(
      path.join(context, 'node_modules/.bin/next'),
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync('/app/proof.json', JSON.stringify({
  authPresent: Boolean(process.env.SENTRY_AUTH_TOKEN),
  releaseMatches: process.env.SENTRY_RELEASE === 'synthetic-revision'
}));
`,
      { mode: 0o755 }
    )
    writeFileSync(path.join(directory, 'token'), sentinel, { mode: 0o600 })
    writeFileSync(
      path.join(context, 'Dockerfile'),
      `FROM ${base}
WORKDIR /app
ARG SENTRY_UPLOAD_SOURCE_MAPS=false
ARG SENTRY_ORG=synthetic-org
ARG SENTRY_PROJECT=synthetic-project
ARG NEXT_PUBLIC_BUILD_SHA=synthetic-revision
COPY . .
${build}
`
    )
    const result = spawnSync(
      'docker',
      [
        'build',
        '--no-cache',
        '--network=none',
        '--progress=plain',
        '--build-arg',
        `SENTRY_UPLOAD_SOURCE_MAPS=${upload}`,
        '-t',
        image,
        ...(secret
          ? [
              '--secret',
              `id=sentry_auth_token,src=${path.join(directory, 'token')}`
            ]
          : []),
        context
      ],
      { encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }
    )
    if (result.error) throw result.error
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(sentinel),
      'Build output must not disclose the token'
    )
    if (result.status !== 0) return { status: result.status }
    const proof = JSON.parse(
      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--network=none',
          image,
          'node',
          '-e',
          `const fs=require('node:fs');process.stdout.write(JSON.stringify({...JSON.parse(fs.readFileSync('/app/proof.json','utf8')),runtimeAuthPresent:Boolean(process.env.SENTRY_AUTH_TOKEN),runtimeSecretPresent:fs.existsSync('/run/secrets/sentry_auth_token')}));`
        ],
        { encoding: 'utf8' }
      )
    )
    const history = execFileSync('docker', ['history', '--no-trunc', image], {
      encoding: 'utf8'
    })
    assert.ok(
      !history.includes(sentinel),
      'Image history must not contain the token'
    )
    return { status: result.status, ...proof }
  } finally {
    spawnSync('docker', ['image', 'rm', '-f', image], { stdio: 'ignore' })
    rmSync(directory, { recursive: true, force: true })
  }
}

test('the production build receives the mounted upload token without persisting it', () => {
  assert.deepEqual(exercise(), {
    status: 0,
    authPresent: true,
    releaseMatches: true,
    runtimeAuthPresent: false,
    runtimeSecretPresent: false
  })
})

test('a required upload fails when its token is missing', () => {
  assert.notEqual(exercise({ secret: false }).status, 0)
})

test('a credential-free local build remains available without uploading', () => {
  assert.deepEqual(exercise({ upload: false, secret: false }), {
    status: 0,
    authPresent: false,
    releaseMatches: false,
    runtimeAuthPresent: false,
    runtimeSecretPresent: false
  })
})

test('the image publication contract passes authorization only as a BuildKit secret', () => {
  const workflow = readFileSync(
    path.join(root, '.github/workflows/build-clean-image.yml'),
    'utf8'
  )
  assert.match(
    workflow,
    /secrets:\s*\|\s*\n\s+sentry_auth_token=\$\{\{ secrets\.SENTRY_AUTH_TOKEN \}\}/
  )
  assert.match(workflow, /SENTRY_UPLOAD_SOURCE_MAPS=true/)
  assert.doesNotMatch(dockerfile, /^(?:ARG|ENV)\s+SENTRY_AUTH_TOKEN\b/m)
  const argumentsBlock = workflow.match(
    /          build-args: \|\n([\s\S]*?)(?=\n          \S)/
  )?.[1]
  assert.ok(argumentsBlock)
  assert.doesNotMatch(argumentsBlock, /SENTRY_AUTH_TOKEN/)
})
