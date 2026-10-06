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

// `start` on a brand-new CLI database fails the CLI's own migration pass
// (see supabase-start-fresh.sh for why) and leaves the stack unusable, so
// it runs through a wrapper that replays this repository's migrations
// itself instead of a plain `supabase start` passthrough. Every other
// subcommand (stop, status, db reset, ...) is unaffected.
const [command, ...rest] = args
const result =
  command === 'start'
    ? spawnSync(
        fileURLToPath(new URL('./supabase-start-fresh.sh', import.meta.url)),
        rest,
        { env, shell: false, stdio: 'inherit' }
      )
    : spawnSync('npx', ['--no-install', 'supabase', ...args], {
        env,
        shell: false,
        stdio: 'inherit'
      })

if (result.error) {
  console.error(`supabase-cli: failed to start: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
