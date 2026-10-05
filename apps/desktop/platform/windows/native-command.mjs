import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const executable = fileURLToPath(
  new URL('../../../../TacticusDesktop.exe', import.meta.url)
)
const allowed = new Set([
  'prompt-official',
  'read-official',
  'remove-official',
  'service-material',
  'confirm-player'
])
// Supervisor-only pipe. Keys never cross this interface; official reads return bounded responses.
export async function nativeCommand(args) {
  if (!allowed.has(args[0]) || args.length > 3)
    throw new Error('Unsupported native operation')
  const child = spawn(resolve(executable), args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const chunks = []
  let size = 0
  child.stdout.on('data', (chunk) => {
    size += chunk.length
    if (size > 4 * 1024 * 1024) child.kill()
    else chunks.push(chunk)
  })
  child.stderr.resume()
  const code = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', accept)
  })
  if (code !== 0 || size > 4 * 1024 * 1024)
    throw new Error('Native secure operation unavailable')
  const body = Buffer.concat(chunks).toString('utf8').trim()
  return body ? JSON.parse(body) : null
}
