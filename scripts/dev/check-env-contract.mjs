#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const roots = ['app', 'apps', 'config', 'packages', 'scripts', 'supabase']
const standalone = [
  'next.config.js',
  'proxy.ts',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'sentry.edge.config.ts',
  'sentry.server.config.ts'
]
const sourceFiles = []

function visit(directory) {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const target = path.join(directory, name)
    if (statSync(target).isDirectory()) visit(target)
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) sourceFiles.push(target)
  }
}

roots.forEach(visit)
sourceFiles.push(...standalone)

const used = new Set()
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    if (!match[1].endsWith('_')) used.add(match[1])
  }
  for (const match of source.matchAll(
    /Deno\.env\.get\(['"]([A-Z][A-Z0-9_]*)['"]\)/g
  ))
    used.add(match[1])
}

const documented = new Set()
for (const line of readFileSync('.env.example', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^#?\s*([A-Z][A-Z0-9_]*)=/)
  if (match) documented.add(match[1])
}

const runtimeProvided = new Set([
  'AWS_LAMBDA_FUNCTION_NAME',
  'BUILD_DATE',
  'BUILD_TIME',
  'CI',
  'CODESPACES',
  'CODESPACE_NAME',
  'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN',
  'GIT_COMMIT',
  'DOCKER_HOST',
  'HOSTNAME',
  'NEXT_BUILD_ID',
  // Inherited OS executable search path and desktop display session, not app settings.
  'PATH',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  // Downward-API pod identity (like HOSTNAME), not app config.
  'POD_NAME',
  'NEXT_PHASE',
  'NEXT_RUNTIME',
  'NODE_ENV',
  // Set by GitHub Actions on every runner; not app config.
  'RUNNER_TEMP'
])
// Consumed by platform CLIs, manifests or external services, so never seen as
// process.env/Deno.env references.
const externallyConsumed = new Set([
  'ADDITIONAL_REDIRECT_URLS',
  'API_EXTERNAL_URL',
  'BASE_URL',
  'CF_API_TOKEN',
  'CF_ZONE_ID',
  'CI_JOB_TOKEN',
  'CODECOV_TOKEN',
  'DATABASE_URL',
  'DB_CONNECTION_TIMEOUT',
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'DB_STATEMENT_TIMEOUT',
  'DISABLE_DISCORD_APPLICATION_WEBHOOK',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_CLUSTER_APPLICATION_WEBHOOK_URL',
  'DISCORD_VERSION_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL',
  'DOCKER_HOST',
  'GITHUB_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SECRET',
  'NEXT_PUBLIC_AUTH_URL',
  'NEXT_PUBLIC_DISCORD_CLIENT_ID',
  'NEXT_PUBLIC_ENABLE_ENHANCED_SPINNERS',
  'NEXT_PUBLIC_ENABLE_FLEXIBLE_TOKENS',
  'NEXT_PUBLIC_ENABLE_LOKI',
  'NEXT_PUBLIC_ENABLE_RESUME_REGISTRATION',
  'NEXT_PUBLIC_ENABLE_TOOLTIPS',
  'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'NEXT_PUBLIC_PRODUCTION_URL',
  'NEXT_PUBLIC_SELFHOSTED_URL',
  'NEXT_PORT',
  'PGPASSWORD',
  'PORT',
  'POSTGRES_PASSWORD',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE',
  'SENTRY_REPLAYS_SESSION_SAMPLE_RATE',
  'SKIP_DEV_SERVER',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SYNC1_PIPELINE_A_EXECUTION_LOCKS_ENABLED',
  'VERCEL_TOKEN'
])
const missing = [...used]
  .filter(
    (name) =>
      !documented.has(name) &&
      !runtimeProvided.has(name) &&
      !externallyConsumed.has(name)
  )
  .sort()
const unused = [...documented]
  .filter(
    (name) =>
      !used.has(name) &&
      !runtimeProvided.has(name) &&
      !externallyConsumed.has(name)
  )
  .sort()

if (missing.length > 0) {
  console.error('env-contract: source variables missing from .env examples:')
  missing.forEach((name) => console.error(`  ${name}`))
  process.exit(1)
}

if (unused.length > 0) {
  console.error('env-contract: documented variables unused by scanned sources:')
  unused.forEach((name) => console.error(`  ${name}`))
  process.exit(1)
}

console.log(
  `env-contract: ${used.size} source variable(s) covered by examples or runtime allowlist.`
)
