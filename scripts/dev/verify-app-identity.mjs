#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC_URL_KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_INTERNAL_URL'
]

function normalizeRepository(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/u, '')
    .replace(/^ssh:\/\/git@github\.com\//u, '')
    .replace(/^https?:\/\/github\.com\//u, '')
    .replace(/\.git$/u, '')
}

function loadNextEnv(root, mode) {
  const values = {}
  const files = [
    `.env.${mode}.local`,
    ...(mode === 'test' ? [] : ['.env.local']),
    `.env.${mode}`,
    '.env'
  ]
  for (const file of files) {
    const parsed = parseEnvFile(resolve(root, file))
    for (const [key, value] of Object.entries(parsed)) {
      if (values[key] === undefined) values[key] = value
    }
  }
  return values
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {}

  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u)
    if (!match) continue
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/u, '$2')
  }
  return values
}

function resolveOrigin(root) {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

export function verifyAppIdentity({ root, env = process.env, origin } = {}) {
  const resolvedRoot = resolve(
    root ?? fileURLToPath(new URL('../..', import.meta.url))
  )
  const contractPath = resolve(resolvedRoot, '.app-identity.json')
  const errors = []

  if (!existsSync(contractPath)) {
    return { errors: ['missing .app-identity.json'], contract: null }
  }

  const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
  const runtime = env.APP_IDENTITY_RUNTIME === '1'
  const packageJson = JSON.parse(
    readFileSync(resolve(resolvedRoot, 'package.json'), 'utf8')
  )

  if (packageJson.name !== contract.packageName) {
    errors.push(
      `package name is ${packageJson.name}; expected ${contract.packageName}`
    )
  }

  const actualOrigin = runtime
    ? null
    : origin === undefined
      ? resolveOrigin(resolvedRoot)
      : origin
  if (actualOrigin) {
    const repository = normalizeRepository(actualOrigin)
    if (repository !== contract.repository) {
      errors.push(`origin is ${repository}; expected ${contract.repository}`)
    }
  }

  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== contract.repository) {
    errors.push(
      `GITHUB_REPOSITORY is ${env.GITHUB_REPOSITORY}; expected ${contract.repository}`
    )
  }

  if (env.TACTICUS_APP_ID && env.TACTICUS_APP_ID !== contract.appId) {
    errors.push(
      `TACTICUS_APP_ID is ${env.TACTICUS_APP_ID}; expected ${contract.appId}`
    )
  }

  // Every signal is conditional (no `.git` in the Docker context), so require
  // at least one discriminating check before reporting success.
  const identitySignals = [
    actualOrigin ? 'origin' : null,
    env.GITHUB_REPOSITORY ? 'GITHUB_REPOSITORY' : null,
    env.TACTICUS_APP_ID ? 'TACTICUS_APP_ID' : null
  ].filter(Boolean)
  if (identitySignals.length === 0) {
    errors.push(
      'no identity signal was available to verify (no git origin, no GITHUB_REPOSITORY, no TACTICUS_APP_ID) — refusing to report OK without checking'
    )
  }

  for (const requiredPath of runtime ? [] : (contract.requiredPaths ?? [])) {
    if (!existsSync(resolve(resolvedRoot, requiredPath))) {
      errors.push(`required app path is missing: ${requiredPath}`)
    }
  }

  for (const forbiddenPath of runtime ? [] : (contract.forbiddenPaths ?? [])) {
    if (existsSync(resolve(resolvedRoot, forbiddenPath))) {
      errors.push(`cross-app path must not exist: ${forbiddenPath}`)
    }
  }

  for (const rule of runtime ? [] : (contract.contentRules ?? [])) {
    const path = resolve(resolvedRoot, rule.path)
    if (!existsSync(path)) {
      errors.push(`identity-controlled file is missing: ${rule.path}`)
      continue
    }
    const content = readFileSync(path, 'utf8')
    for (const required of rule.required ?? []) {
      if (!content.includes(required)) {
        errors.push(`identity marker is missing from ${rule.path}: ${required}`)
      }
    }
    for (const forbidden of rule.forbidden ?? []) {
      if (content.includes(forbidden)) {
        errors.push(`cross-app marker exists in ${rule.path}: ${forbidden}`)
      }
    }
  }

  const allowedSiteHosts = new Set([
    ...(contract.siteHosts ?? []),
    ...(contract.localHosts ?? [])
  ])
  const allowedApiHosts = new Set([
    ...(contract.apiHosts ?? []),
    ...(contract.internalApiHosts ?? []),
    ...(contract.localHosts ?? [])
  ])

  // Validate the effective development and production envs, so a value in a
  // mode-specific .env.*.local cannot bypass the lifecycle hook.
  for (const mode of ['development', 'production']) {
    const fileEnv = loadNextEnv(resolvedRoot, mode)
    for (const key of PUBLIC_URL_KEYS) {
      const value = env[key] ?? fileEnv[key]
      if (!value) continue

      try {
        const hostname = new URL(value).hostname
        const allowedHosts = key.includes('SUPABASE')
          ? allowedApiHosts
          : allowedSiteHosts
        if (!allowedHosts.has(hostname)) {
          const message = `${key} uses forbidden host ${hostname}`
          if (!errors.includes(message)) errors.push(message)
        }
      } catch {
        const message = `${key} is not a valid URL`
        if (!errors.includes(message)) errors.push(message)
      }
    }
  }

  return { errors, contract }
}

function main() {
  const result = verifyAppIdentity()
  if (result.errors.length > 0) {
    console.error('APP IDENTITY BLOCKED: this workspace is not safe to run')
    for (const error of result.errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log(
    `APP IDENTITY OK: ${result.contract.displayName} | repo=${result.contract.repository} | site=${result.contract.siteHosts[0]}`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
