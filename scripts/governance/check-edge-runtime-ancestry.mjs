#!/usr/bin/env node
// Ancestry gate for the live edge-runtime image in `tacticus`: its tag's commit
// prefix must be an ancestor of origin/main. Not a required check.
// EDGE_RUNTIME_LIVE_TAG overrides the kubectl lookup locally and is refused in CI.

import { execFileSync } from 'node:child_process'

const NAMESPACE = 'tacticus'
const DEPLOYMENT = 'supabase-edge-functions'
const CONTAINER = 'edge-runtime'

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  }).trim()
}

function overrideRefusedInCi() {
  return Boolean(process.env.EDGE_RUNTIME_LIVE_TAG) && Boolean(process.env.CI)
}

function usingOverride() {
  return Boolean(process.env.EDGE_RUNTIME_LIVE_TAG)
}

function getLiveImage() {
  if (process.env.EDGE_RUNTIME_LIVE_TAG) {
    return `test-override:${process.env.EDGE_RUNTIME_LIVE_TAG}`
  }
  return sh('kubectl', [
    'get',
    'deployment',
    DEPLOYMENT,
    '-n',
    NAMESPACE,
    '-o',
    `jsonpath={range .spec.template.spec.containers[?(@.name=="${CONTAINER}")]}{.image}{end}`
  ])
}

function extractTag(image) {
  const withoutDigest = image.split('@')[0]
  const idx = withoutDigest.lastIndexOf(':')
  if (idx === -1) {
    throw new Error(`image string has no tag: ${image}`)
  }
  return withoutDigest.slice(idx + 1)
}

function resolvesAsCommit(sha) {
  try {
    const type = sh('git', ['cat-file', '-t', sha])
    return type === 'commit'
  } catch {
    return false
  }
}

function isAncestorOfMain(sha) {
  try {
    sh('git', ['merge-base', '--is-ancestor', sha, 'origin/main'])
    return true
  } catch {
    return false
  }
}

function main() {
  const lines = []
  lines.push(`Edge-runtime ancestry gate -- namespace=${NAMESPACE}`)
  lines.push(
    `Deployment: ${DEPLOYMENT}, container: ${CONTAINER} (this repo's own namespace only)`
  )
  lines.push('')

  if (overrideRefusedInCi()) {
    lines.push(
      'RESULT: FAIL -- EDGE_RUNTIME_LIVE_TAG is set while $CI is set. REFUSED.'
    )
    lines.push(
      '  That variable bypasses the live-cluster read completely. Honouring it'
    )
    lines.push(
      '  here would make this gate report PASS against a fabricated tag no'
    )
    lines.push(
      '  matter what is actually deployed -- a check that cannot fail.'
    )
    lines.push(
      `  Offending value: EDGE_RUNTIME_LIVE_TAG=${process.env.EDGE_RUNTIME_LIVE_TAG}`
    )
    lines.push(
      '  Fix: unset EDGE_RUNTIME_LIVE_TAG in this environment. Check repo,'
    )
    lines.push('  organization and environment variables/secrets, not just the')
    lines.push('  workflow file -- the workflow never sets it.')
    lines.push(
      '  The override remains available for LOCAL runs, where $CI is unset.'
    )
    console.log(lines.join('\n'))
    process.exitCode = 1
    return
  }

  if (usingOverride()) {
    lines.push(
      'NOTE: EDGE_RUNTIME_LIVE_TAG is set -- the live cluster was NOT read.'
    )
    lines.push(
      '  This is a local exercise of the ancestry logic, not a verification'
    )
    lines.push('  of what is deployed. It is refused when $CI is set.')
    lines.push('')
  }

  let image
  try {
    image = getLiveImage()
    if (!image) {
      throw new Error(
        `no container named "${CONTAINER}" found on deployment "${DEPLOYMENT}" in namespace "${NAMESPACE}"`
      )
    }
  } catch (err) {
    lines.push(`RESULT: FAIL -- could not reach live state: ${err.message}`)
    console.log(lines.join('\n'))
    process.exitCode = 1
    return
  }
  lines.push(`Live image: ${image}`)

  let tag
  try {
    tag = extractTag(image)
  } catch (err) {
    lines.push(`RESULT: FAIL -- ${err.message}`)
    console.log(lines.join('\n'))
    process.exitCode = 1
    return
  }
  lines.push(`Live tag: ${tag}`)

  sh('git', ['fetch', 'origin', 'main', '--quiet'])

  if (!resolvesAsCommit(tag)) {
    lines.push(
      `RESULT: FAIL -- "${tag}" does not resolve as a git object in this repo at all.`
    )
    lines.push(
      "  The deployed image was not built from this repo's history -- " +
        "it is not merely behind main, it is not this repo's commit."
    )
    console.log(lines.join('\n'))
    process.exitCode = 1
    return
  }

  if (!isAncestorOfMain(tag)) {
    lines.push(
      `RESULT: FAIL -- ${tag} resolves as a commit here but is not an ancestor of origin/main.`
    )
    console.log(lines.join('\n'))
    process.exitCode = 1
    return
  }

  if (usingOverride()) {
    lines.push(
      `RESULT: PASS (LOCAL OVERRIDE -- NOT a live check) -- ${tag} is an ancestor of origin/main.`
    )
  } else {
    lines.push(`RESULT: PASS -- ${tag} is an ancestor of origin/main.`)
  }
  console.log(lines.join('\n'))
  process.exitCode = 0
}

main()
