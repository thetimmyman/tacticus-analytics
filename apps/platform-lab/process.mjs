import { spawn, spawnSync } from 'node:child_process'

/** Executes an explicitly supplied tool without a shell; kills only its owned group or process tree. */
export async function runOwnedProcess(
  file,
  args,
  { cwd, env = process.env, timeoutMs = 120000, maxBytes = 1024 * 1024 } = {}
) {
  if (
    typeof file !== 'string' ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== 'string') ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 64 * 1024 * 1024
  )
    throw new Error('Invalid bounded process')
  const child = spawn(file, args, {
    cwd,
    env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = '',
    bytes = 0,
    exceeded = false,
    timedOut = false
  const terminate = () => {
    try {
      if (process.platform === 'win32') {
        // child.kill() ends only the immediate process; /T ends the whole tree.
        const result = spawnSync(
          'taskkill',
          ['/pid', String(child.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true }
        )
        if (result.status !== 0) child.kill('SIGKILL')
      } else process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  const capture = (chunk) => {
    bytes += chunk.length
    if (bytes > maxBytes) {
      exceeded = true
      terminate()
    } else output += chunk.toString('utf8')
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const timer = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMs)
  try {
    const code = await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('close', accept)
    })
    return { code, output, timedOut, exceeded }
  } finally {
    clearTimeout(timer)
  }
}
