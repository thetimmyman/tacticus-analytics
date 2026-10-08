import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

if (process.platform !== 'win32')
  throw new Error('Native helper diagnostic requires Windows')
const [host, root] = process.argv.slice(2)
const desktop = await readFile(join(root, 'owner-desktop.txt'), 'utf8')
const cases = []
for (const [mode, windowsHide, stdin] of [
  ['hidden-pipes', true, 'ignore'],
  ['attached-pipes', false, 'ignore'],
  ['hidden-inherited-input', true, 'inherit']
]) {
  const helpers = []
  for (const operation of ['proof-service-material', 'proof-desktop']) {
    const record = join(root, `${mode}-${operation}.txt`)
    const child = spawn(host, [operation, record], {
      windowsHide,
      stdio: [stdin, 'pipe', 'pipe']
    })
    child.stdout.resume()
    child.stderr.resume()
    let errorCode = null
    child.once('error', (error) => {
      errorCode = ['EACCES', 'EINVAL', 'ENOENT'].includes(error.code)
        ? error.code
        : 'OWNED_SPAWN_REFUSED'
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 20000)
    const exitCode = await new Promise((accept) => child.once('close', accept))
    clearTimeout(timer)
    if (timedOut) errorCode = 'OWNED_HELPER_TIMEOUT'
    let completed = false,
      ownerDesktopMatches = null
    if (exitCode === 0) {
      const value = await readFile(record, 'utf8')
      completed =
        operation === 'proof-service-material' ? value === 'true' : true
      if (operation === 'proof-desktop') ownerDesktopMatches = value === desktop
    }
    helpers.push({
      operation,
      exitCode,
      errorCode,
      completed,
      ownerDesktopMatches
    })
  }
  cases.push({ mode, helpers })
}
await writeFile(
  join(root, 'helper-result.json'),
  JSON.stringify({ nodeVersion: process.version, cases }),
  { flag: 'wx', mode: 0o600 }
)
