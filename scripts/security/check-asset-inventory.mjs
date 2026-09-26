#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const INVENTORY_PATH = 'public/asset-provenance.json'
const DOCKERIGNORE_PATH =
  process.env.ASSET_GATE_DOCKERIGNORE_PATH || '.dockerignore'
const RUNTIME_DOCKERFILE_PATH =
  process.env.ASSET_GATE_DOCKERFILE_PATH || 'docker/Dockerfile.prod'
const VISUAL_ASSET = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu

function trackedVisualAssets() {
  return execFileSync('git', ['ls-files', '-z', 'public'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter((file) => VISUAL_ASSET.test(file))
}

function matchesGroup(file, group) {
  return (
    group.exactPaths.includes(file) ||
    group.pathPrefixes.some((prefix) => file.startsWith(prefix))
  )
}

const inventory = JSON.parse(
  fs.readFileSync(path.join(ROOT, INVENTORY_PATH), 'utf8')
)
const files = trackedVisualAssets()
const violations = []

function dockerIgnoreEntries() {
  return fs
    .readFileSync(path.resolve(ROOT, DOCKERIGNORE_PATH), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function trackedSourceReference(asset) {
  const publicUrl = asset.replace(/^public/u, '')
  const result = spawnSync(
    'git',
    ['grep', '-n', '-F', '--', publicUrl, '--', 'app', 'packages'],
    { cwd: ROOT, encoding: 'utf8' }
  )

  if (result.status === 0) return result.stdout.trim().split('\n')[0]
  if (result.status === 1) return null
  return `git grep failed: ${result.stderr.trim() || `exit ${result.status}`}`
}

if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.groups)) {
  violations.push('asset inventory has an unsupported schema')
}

for (const file of files) {
  const matches = inventory.groups.filter((group) => matchesGroup(file, group))
  if (matches.length !== 1) {
    violations.push(
      `${file}: expected exactly one provenance group, found ${matches.length}`
    )
  }
}

for (const group of inventory.groups) {
  const actualCount = files.filter((file) => matchesGroup(file, group)).length
  if (actualCount !== group.trackedAssetCount) {
    violations.push(
      `${group.id}: inventory count ${group.trackedAssetCount} does not match ${actualCount} tracked assets`
    )
  }
  if (
    typeof group.source !== 'string' ||
    typeof group.rightsStatus !== 'string' ||
    typeof group.publicationApproved !== 'boolean'
  ) {
    violations.push(`${group.id}: provenance metadata is incomplete`)
  }
}

if (process.argv.includes('--publication')) {
  // A zero-asset group is a denylist for the runtime-PII gate; it cannot block publication.
  const blocked = inventory.groups.filter(
    (group) => group.publicationApproved !== true && group.trackedAssetCount > 0
  )
  if (inventory.publicationCertified !== true || blocked.length > 0) {
    violations.push(
      `publication is not certified; unresolved groups: ${blocked
        .map((group) => group.id)
        .join(', ')}`
    )
  }
}

if (process.argv.includes('--runtime-pii')) {
  const dockerfileSpecificIgnore = `${RUNTIME_DOCKERFILE_PATH}.dockerignore`
  if (fs.existsSync(path.resolve(ROOT, dockerfileSpecificIgnore))) {
    violations.push(
      `${dockerfileSpecificIgnore}: Dockerfile-specific ignore files override the audited root .dockerignore`
    )
  }
  const ignored = dockerIgnoreEntries()
  const restricted = inventory.groups.filter(
    (group) =>
      group.containsPersonalIdentity === true &&
      group.publicationApproved !== true
  )

  if (restricted.length === 0) {
    violations.push(
      'runtime PII gate has no identity-bearing provenance group to enforce'
    )
  }

  for (const group of restricted) {
    if (group.pathPrefixes.length > 0) {
      violations.push(
        `${group.id}: runtime PII groups must enumerate exactPaths for auditable Docker exclusions`
      )
    }
    for (const asset of group.exactPaths) {
      const exclusionIndex = ignored.lastIndexOf(asset)
      if (exclusionIndex === -1) {
        violations.push(`${asset}: missing exact .dockerignore exclusion`)
      } else if (
        ignored.slice(exclusionIndex + 1).some((entry) => entry.startsWith('!'))
      ) {
        // Protected exclusions are final here: fail closed on any later negation, not parse Docker globs.
        violations.push(
          `${asset}: a later .dockerignore negation could re-include a restricted asset`
        )
      }
      const reference = trackedSourceReference(asset)
      if (reference) {
        violations.push(
          `${asset}: still referenced by runtime source at ${reference}`
        )
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Asset provenance gate failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

const counts = inventory.groups
  .map((group) => `${group.id}=${group.trackedAssetCount}`)
  .join(', ')
console.log(
  `Asset inventory covers ${files.length} tracked visuals (${counts}).`
)
