#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

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

const result = spawnSync('npx', ['--no-install', 'supabase', ...args], {
  env,
  shell: false,
  stdio: 'inherit'
})

if (result.error) {
  console.error(`supabase-cli: failed to start: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
