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
  'confirm-player',
  'choose-export',
  'export-personal',
  'choose-import',
  'read-import'
])
export function nativeFailureDiagnostic(output, code) {
  const prefix = output.slice(0, 8192)
  const status = Number.isInteger(code) ? `exit-${code}` : 'exit-unavailable'
  const osStatus = /Native OS operation failed; status (\d{1,10})\./.exec(
    prefix
  )
  const category =
    code === 3221225794 || code === -1073741502
      ? 'native-dll-initialization-failed-0xc0000142'
      : osStatus
        ? `native-os-status-${osStatus[1]}`
        : /Failed to (?:create CoreCLR|load (?:the dll|System\.Private\.CoreLib))/.test(
              prefix
            )
          ? 'native-runtime-load-refused'
          : 'native-operation-refused'
  return `${category}; ${status}; sensitive output suppressed`
}
// Supervisor-only pipe. Keys never cross this interface; official reads return bounded responses.
export async function nativeCommand(args, input) {
  if (!allowed.has(args[0]) || args.length > 3)
    throw new Error('Unsupported native operation')
  const child = spawn(resolve(executable), args, {
    // Keep the owner's console connection. CREATE_NO_WINDOW fails DLL
    // initialization for reduced-token descendants; streams remain private pipes.
    windowsHide: false,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe']
  })
  if (input) child.stdin.end(input)
  const chunks = []
  let size = 0
  child.stdout.on('data', (chunk) => {
    size += chunk.length
    if (size > 4 * 1024 * 1024) child.kill()
    else chunks.push(chunk)
  })
  const diagnostics = []
  let diagnosticSize = 0
  child.stderr.on('data', (chunk) => {
    const prefix = chunk.subarray(0, Math.max(0, 8192 - diagnosticSize))
    diagnosticSize += prefix.length
    if (prefix.length) diagnostics.push(prefix)
  })
  const code = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('close', accept)
  })
  if (code !== 0 || size > 4 * 1024 * 1024)
    throw Object.assign(
      new Error(
        code === 4
          ? 'Unlock your local workspace to continue.'
          : code === 2
            ? 'Windows secure input or vault is unavailable.'
            : code === 3
              ? 'Official access is invalid, expired or unavailable.'
              : `Native secure operation unavailable; ${nativeFailureDiagnostic(Buffer.concat(diagnostics).toString('utf8'), code)}`
      ),
      {
        code:
          code === 4
            ? 'ESESSION'
            : code === 2
              ? 'EVAULTLOCKED'
              : code === 3
                ? 'EUPSTREAM'
                : 'ENATIVE'
      }
    )
  const body = Buffer.concat(chunks).toString('utf8').trim()
  return body ? JSON.parse(body) : null
}
