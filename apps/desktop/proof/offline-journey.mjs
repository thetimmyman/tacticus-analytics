import { spawnSync, execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/**
 * Gate (b) proof: runs native-journey.mts inside a kernel-enforced offline
 * network namespace. Usage: offline-journey.mjs <absolute config.json>; see
 * apps/desktop/proof-readme.md for the config.json shape. See
 * buildOfflineUnshareArgs below for why a single `unshare -rn` is not enough.
 */

function hasUnshare() {
  try {
    execSync('unshare --help', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function shellQuote(part) {
  return `'${String(part).replaceAll("'", "'\\''")}'`
}

/**
 * `unshare -rn` (root-mapped) is the only way to create an unprivileged
 * netns on a host without `/etc/subuid` delegation, but initdb/postgres
 * refuse to run as uid 0. So: bring up the netns's down-by-default loopback
 * as root, then nest an unprivileged userns mapping the real uid/gid back
 * onto that root identity, keeping the netns, before exec'ing the harness.
 */
export function buildOfflineUnshareArgs({ uid, gid, journeyPath, configPath }) {
  if (!Number.isInteger(uid) || uid < 0)
    throw new Error('uid must be a non-negative integer')
  if (!Number.isInteger(gid) || gid < 0)
    throw new Error('gid must be a non-negative integer')
  const innerCommand = [
    'exec',
    'unshare',
    '--map-user',
    String(uid),
    '--map-group',
    String(gid),
    '--',
    'node',
    '--conditions=react-server',
    '--import',
    'tsx',
    journeyPath,
    configPath
  ]
    .map(shellQuote)
    .join(' ')
  const command = `ip link set lo up && ${innerCommand}`
  return ['-rn', '--', 'sh', '-c', command]
}

async function main() {
  const configPath = process.argv[2]
  if (!configPath || !isAbsolute(configPath))
    throw new Error('Usage: offline-journey.mjs <absolute config.json path>')
  if (!hasUnshare()) {
    const report = {
      gate: 'offline-player-performance',
      status: 'skipped',
      reason: 'unshare (util-linux) is not available on this host'
    }
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = 1
    return
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  if (!config.application) {
    const report = {
      gate: 'offline-player-performance',
      status: 'skipped',
      reason:
        'config.application (staged standalone Next.js server + node binary) is not set; see apps/desktop/proof-readme.md'
    }
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = 1
    return
  }
  const journeyPath = new URL('./native-journey.mts', import.meta.url).pathname
  const unshareArgs = buildOfflineUnshareArgs({
    uid: process.getuid(),
    gid: process.getgid(),
    journeyPath,
    configPath
  })
  const result = spawnSync('unshare', unshareArgs, { stdio: 'inherit' })
  const report = {
    gate: 'offline-player-performance',
    status: result.status === 0 ? 'passed' : 'failed',
    command:
      "unshare -rn -- sh -c 'ip link set lo up && exec unshare --map-user <uid> --map-group <gid> -- " +
      "node --conditions=react-server --import tsx apps/desktop/proof/native-journey.mts <config.json>'",
    exitCode: result.status
  }
  if (config.evidence)
    await writeFile(
      config.evidence.replace('.json', '-offline.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 }
    )
  console.log(JSON.stringify(report, null, 2))
  if (result.status !== 0) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
