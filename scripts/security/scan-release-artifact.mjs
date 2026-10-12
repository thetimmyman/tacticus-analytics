#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

// Path patterns that must never appear in a release artifact's file inventory.
// Each matcher runs against a single inventory file path (relative or absolute).
const base = (p) => p.split(/[/\\]/).pop()
const PRIVATE_PATTERNS = [
  { name: '.env', test: (p) => /^\.env(\..*)?$/i.test(base(p)) },
  { name: '*.pem', test: (p) => /\.pem$/i.test(p) },
  { name: '*.p12', test: (p) => /\.p12$/i.test(p) },
  { name: '*.pfx', test: (p) => /\.pfx$/i.test(p) },
  { name: '*.jks', test: (p) => /\.jks$/i.test(p) },
  { name: '*.key', test: (p) => /\.key$/i.test(p) },
  {
    name: 'ssh private key',
    test: (p) => /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/i.test(base(p))
  },
  {
    name: 'credentials file',
    test: (p) => /^credentials(\.json)?$/i.test(base(p))
  },
  { name: 'secrets directory', test: (p) => /(^|[/\\])secrets[/\\]/i.test(p) },
  { name: '*.sqlite', test: (p) => /\.sqlite3?$/i.test(p) },
  { name: '.pgpass', test: (p) => base(p).toLowerCase() === '.pgpass' },
  { name: '*.tfvars', test: (p) => /\.tfvars$/i.test(p) },
  { name: 'database state', test: (p) => /(^|[/\\])pgdata[/\\]/i.test(p) },
  {
    name: 'mutable application state',
    test: (p) =>
      /^(workspace-owner|onboarding|official-pending|window-config)\.json$/i.test(
        base(p)
      )
  }
]

// Pure: returns a list of human-readable violation strings for any file path
// that matches a private/credential/dataset pattern. A path matches at most one
// violation (the first matching pattern wins), so counts are stable.
export function evaluate(fileEntries) {
  if (
    !Array.isArray(fileEntries) ||
    !fileEntries.length ||
    fileEntries.some((file) => typeof file?.path !== 'string')
  )
    return ['inventory must be a non-empty array of entries with a path']
  const violations = []
  for (const file of fileEntries) {
    const rel = file.path
    for (const { name, test } of PRIVATE_PATTERNS) {
      if (test(rel)) {
        violations.push(
          `${rel}: private/credential/dataset material (matched ${name})`
        )
        break
      }
    }
  }
  return violations
}

function selfTest() {
  const planted = evaluate([
    { path: '.env' },
    { path: 'config/.env.local' },
    { path: 'certs/server.pem' },
    { path: 'certs/bundle.p12' },
    { path: 'secrets/db.key' },
    { path: '.ssh/id_rsa' },
    { path: '.ssh/id_ecdsa' },
    { path: '.ssh/id_ed25519' },
    { path: 'data/private.sqlite' },
    { path: 'config/credentials.json' },
    { path: 'workspace-owner.json' },
    { path: '.pgpass' },
    { path: 'a/secrets/token.txt' },
    { path: 'key.pfx' },
    { path: 'trust.jks' }
  ])
  if (planted.length !== 15) {
    throw new Error(
      `positive control failed: expected 15 violations, got ${planted.length} (${planted.join('; ')})`
    )
  }

  const safe = evaluate([
    { path: 'app/index.js' },
    { path: 'node_modules/foo/index.js' },
    { path: 'LICENSE' },
    { path: 'THIRD_PARTY_NOTICES.md' },
    { path: 'bin/node' },
    { path: 'electron' },
    { path: 'application-notices.json' },
    { path: 'notices/node-LICENSE' },
    { path: 'applications/api.mjs' },
    { path: 'apps/desktop/launcher/launch.mjs' }
  ])
  if (safe.length !== 0) {
    throw new Error(`negative control failed: ${safe.join('; ')}`)
  }

  console.log('release-artifact scan self-test passed')
}

function resolveInventoryPath() {
  const flag = process.argv.indexOf('--inventory')
  const provided = flag !== -1 ? process.argv[flag + 1] : null
  return path.resolve(ROOT, provided || 'package-inventory.json')
}

function scan() {
  const inventoryPath = resolveInventoryPath()
  if (!fs.existsSync(inventoryPath)) {
    console.error(
      `Release artifact scan FAILED: inventory not found at ${inventoryPath}`
    )
    process.exit(1)
  }
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
  const violations = evaluate(inventory.files)

  if (violations.length > 0) {
    console.error(
      'Release artifact scan FAILED: private material found in package:'
    )
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log(
    `Release artifact scan passed: ${inventory.files?.length ?? 0} files inspected, no private material.`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const command = process.argv[2] ?? '--scan'
  if (command === '--selftest') selfTest()
  else if (command === '--scan') scan()
  else {
    console.error(
      'usage: scan-release-artifact.mjs [--selftest|--scan] [--inventory <path>]'
    )
    process.exit(2)
  }
}
