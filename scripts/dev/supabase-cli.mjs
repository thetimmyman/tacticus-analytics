#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

function detectDockerHost() {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST

  const uid = process.getuid?.()
  const sockets = [
    '/var/run/docker.sock',
    uid == null ? null : `/run/user/${uid}/podman/podman.sock`,
    '/run/podman/podman.sock'
  ].filter(Boolean)

  const socket = sockets.find((candidate) => existsSync(candidate))
  return socket ? `unix://${socket}` : null
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error(
    'supabase-cli: pass a Supabase CLI command, for example `status`.'
  )
  process.exit(2)
}

const env = { ...process.env }
const dockerHost = detectDockerHost()
if (dockerHost) {
  env.DOCKER_HOST = dockerHost
  if (!process.env.DOCKER_HOST) {
    console.error(`supabase-cli: using ${dockerHost}`)
  }
} else {
  console.error(
    'supabase-cli: no Docker-compatible socket found. Start Docker or `systemctl --user start podman.socket`.'
  )
}

const freshStart = (extraArgs) =>
  spawnSync(
    fileURLToPath(new URL('./supabase-start-fresh.sh', import.meta.url)),
    extraArgs,
    { env, shell: false, stdio: 'inherit' }
  )

// `start` and `db reset` both fail the CLI's own migration pass on a
// database it manages itself (see supabase-start-fresh.sh for why), so both
// route through the fresh-start wrapper instead of a plain passthrough.
// `db reset` additionally discards the existing volume first, matching
// what a reset is supposed to do. Every other subcommand is unaffected.
const [command, sub, ...rest] = args
let result
if (command === 'start') {
  result = freshStart(args.slice(1))
} else if (command === 'db' && sub === 'reset') {
  const stopResult = spawnSync(
    'npx',
    ['--no-install', 'supabase', 'stop', '--no-backup'],
    { env, shell: false, stdio: 'inherit' }
  )
  if (stopResult.error) {
    console.error(`supabase-cli: failed to stop: ${stopResult.error.message}`)
    process.exit(1)
  }
  result = freshStart(rest)
} else {
  result = spawnSync('npx', ['--no-install', 'supabase', ...args], {
    env,
    shell: false,
    stdio: 'inherit'
  })
}

if (result.error) {
  console.error(`supabase-cli: failed to start: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
