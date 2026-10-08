import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const electronControlPins = {
  arm64: '1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c',
  x64: 'e567d13833d0e161d7749727355b98643461df3395b537cfa7bdddf8a8bfedff'
}
export async function runNavigationControl({
  electron,
  guard,
  output,
  sourceCommit,
  script = fileURLToPath(new URL('./navigation-control.cjs', import.meta.url)),
  artifactSha256
}) {
  if (
    process.platform !== 'darwin' ||
    ![electron, guard, output, script].every(
      (value) => typeof value === 'string' && isAbsolute(value)
    ) ||
    !/^[a-f0-9]{40}$/.test(sourceCommit ?? '')
  )
    throw new Error('Pinned native control inputs required')
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const sourceBytes = await readFile(
    new URL('./navigation-control.cjs', import.meta.url)
  )
  if (hash(await readFile(script)) !== hash(sourceBytes))
    throw new Error('Installed control source mismatch')
  const child = spawn(
    guard,
    ['--run', output + '-owner.lock', electron, script, output],
    {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR
      },
      stdio: 'ignore'
    }
  )
  const deadline = setTimeout(() => child.kill('SIGTERM'), 90000)
  const escalation = setTimeout(() => child.kill('SIGKILL'), 95000)
  let code
  try {
    code = await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('close', accept)
    })
  } finally {
    clearTimeout(deadline)
    clearTimeout(escalation)
  }
  if (code !== 0) throw new Error('Native navigation control process failed')
  const result = JSON.parse(await readFile(output, 'utf8'))
  const expectedModes = [
    'completed-post',
    'truncated-get',
    'navigate-get',
    'navigate-post',
    'immediate-post',
    'beforeunload-post',
    'keepalive-post',
    'rsc-prefetch-get'
  ]
  if (
    result.schemaVersion !== 'macos-navigation-control/v1' ||
    result.electron !== '44.5.1' ||
    result.architecture !== process.arch ||
    result.sandbox !== true ||
    result.accepted !== false ||
    result.productAcceptance !== false ||
    result.results?.length !== 8 ||
    result.results.some(
      (value, index) =>
        value.mode !== expectedModes[index] ||
        value.nodeAccess !== false ||
        value.blocked !== 0 ||
        (value.requestObserved !== false && !value.events?.length)
    ) ||
    result.results[0].mode !== 'completed-post' ||
    !result.results[0].events.some(
      (value) => value.outcome === 'completed' && value.status === 200
    ) ||
    result.results[1].mode !== 'truncated-get' ||
    !result.results[1].events.some((value) => value.outcome === 'error')
  )
    throw new Error(
      'Native navigation control safety or baseline assertion failed'
    )
  const receipt = {
    ...result,
    sourceCommit,
    controlSourceSha256: hash(sourceBytes),
    electronArchiveSha256: electronControlPins[process.arch],
    electronExecutableSha256: hash(await readFile(electron)),
    guardSha256: hash(await readFile(guard)),
    ...(artifactSha256 ? { productArtifactSha256: artifactSha256 } : {})
  }
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', {
    mode: 0o600
  })
  return receipt
}
