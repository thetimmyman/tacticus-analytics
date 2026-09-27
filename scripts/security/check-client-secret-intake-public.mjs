#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PRIVATE_FLAG_NAMES = [
  'CLIENT_SECRET_INTAKE_ENABLED',
  'NEXT_PUBLIC_CLIENT_SECRET_INTAKE_ENABLED'
]
const DEPLOYMENT_ROOTS = [
  '.github/workflows',
  'docker',
  'k8s',
  'scripts/deploy'
]

function walk(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  if (!fs.existsSync(absolutePath)) return []
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) return [relativePath]
  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => walk(path.join(relativePath, entry.name)))
}

function findViolations(files) {
  const violations = []

  for (const [file, content] of Object.entries(files)) {
    if (
      DEPLOYMENT_ROOTS.some(
        (root) => file === root || file.startsWith(`${root}/`)
      )
    ) {
      for (const flag of PRIVATE_FLAG_NAMES) {
        if (content.includes(flag)) {
          violations.push(`${file}: public deployment surface binds ${flag}`)
        }
      }
    }

    if (/CLIENT_SECRET_INTAKE_ENABLED\s*=\s*true\b/i.test(content)) {
      violations.push(`${file}: client-secret intake defaults true`)
    }
  }

  return violations
}

function requiredSourceChecks(files) {
  const violations = []
  for (const retiredPath of [
    'app/api/guild-war/config/route.ts',
    'app/(dashboard)/war-tracking/components/WarSyncConfig.tsx',
    'app/(dashboard)/replays/config/page.tsx',
    'app/(dashboard)/leaderboards/components/cluster-management/components/GuildCaptureCredentialSection.tsx'
  ]) {
    if (files[retiredPath] !== undefined) {
      violations.push(
        `${retiredPath}: retired client-secret intake surface exists`
      )
    }
  }

  return violations
}

function selfTest() {
  const planted = findViolations({
    'k8s/base/example.yaml':
      'name: CLIENT_SECRET_INTAKE_ENABLED\nvalue: "true"',
    '.env.example': 'NEXT_PUBLIC_CLIENT_SECRET_INTAKE_ENABLED=true\n'
  })
  if (planted.length < 2) {
    throw new Error(
      'positive control failed: public intake bindings were not detected'
    )
  }

  const safe = findViolations({
    '.env.example':
      'CLIENT_SECRET_INTAKE_ENABLED=false\nNEXT_PUBLIC_CLIENT_SECRET_INTAKE_ENABLED=false\n'
  })
  if (safe.length !== 0) {
    throw new Error(`negative control failed: ${safe.join('; ')}`)
  }

  console.log('client-secret public-boundary self-test passed')
}

function scan() {
  const paths = [
    ...DEPLOYMENT_ROOTS.flatMap(walk),
    '.env.example',
    'app/api/guild-war/config/route.ts',
    'app/(dashboard)/war-tracking/components/WarSyncConfig.tsx',
    'app/(dashboard)/replays/config/page.tsx',
    'app/(dashboard)/leaderboards/components/cluster-management/components/GuildCaptureCredentialSection.tsx'
  ]
  const files = Object.fromEntries(
    [...new Set(paths)]
      .filter((file) => fs.existsSync(path.join(ROOT, file)))
      .map((file) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')])
  )
  const violations = [...findViolations(files), ...requiredSourceChecks(files)]

  if (violations.length > 0) {
    console.error('Client-secret public boundary FAILED:')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }

  console.log('Client-secret public boundary passed')
}

const command = process.argv[2] ?? '--scan'
if (command === '--selftest') selfTest()
else if (command === '--scan') scan()
else {
  console.error(
    'usage: check-client-secret-intake-public.mjs [--selftest|--scan]'
  )
  process.exit(2)
}
