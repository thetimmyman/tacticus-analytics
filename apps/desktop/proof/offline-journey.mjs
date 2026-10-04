import { spawnSync, execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/**
 * Gate (b) proof: runs the existing native-journey.mts harness (native
 * services + staged standalone Next.js + /player-performance assertions)
 * inside `unshare -rn`, so "offline" is kernel-enforced, not just
 * harness-enforced. Usage: offline-journey.mjs <absolute config.json>.
 * See apps/desktop/proof-readme.md for the config.json shape.
 */

const configPath = process.argv[2]
if (!configPath || !isAbsolute(configPath))
  throw new Error('Usage: offline-journey.mjs <absolute config.json path>')

function hasUnshare() {
  try {
    execSync('unshare --help', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function main() {
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
  const result = spawnSync(
    'unshare',
    [
      '-rn',
      '--',
      'node',
      '--conditions=react-server',
      '--import',
      'tsx',
      new URL('./native-journey.mts', import.meta.url).pathname,
      configPath
    ],
    { stdio: 'inherit' }
  )
  const report = {
    gate: 'offline-player-performance',
    status: result.status === 0 ? 'passed' : 'failed',
    command:
      'unshare -rn -- node --conditions=react-server --import tsx apps/desktop/proof/native-journey.mts <config.json>',
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

await main()
