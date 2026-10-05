import { spawn as spawnProcess } from 'node:child_process'

const prompts = {
  'workspace-password': {
    title: 'Confirm local workspace',
    text: 'Enter your current workspace password.',
    bytes: 1024
  },
  'official-key': {
    title: 'Connect official Tacticus API',
    text: 'Enter your own official Tacticus API key. The key is kept in the OS-backed vault.',
    bytes: 64
  }
}
const failure = (code = 'ENATIVEDIALOG') =>
  Object.assign(
    new Error(
      code === 'ECANCEL'
        ? 'Connection cancelled.'
        : 'The native secret dialog is unavailable.'
    ),
    { code }
  )

// Native OS input goes directly to trusted main memory. Secret values never
// enter process arguments, environment variables, renderer IPC or diagnostics.
export function nativeSecretPrompt(
  kind,
  { signal, spawn = spawnProcess, platform = process.platform } = {}
) {
  if (platform !== 'linux' || !Object.hasOwn(prompts, kind))
    return Promise.reject(failure())
  if (signal?.aborted) return Promise.reject(failure('ECANCEL'))
  const prompt = prompts[kind]
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(
        '/usr/bin/zenity',
        [
          '--entry',
          '--hide-text',
          '--title',
          prompt.title,
          '--text',
          prompt.text
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      )
    } catch {
      reject(failure())
      return
    }
    let parts = [],
      bytes = 0,
      reason,
      killTimer,
      closed = false
    const stop = (code) => {
      if (closed || reason) return
      reason = code
      child.kill('SIGTERM')
      if (!killTimer)
        killTimer = setTimeout(() => {
          child.kill('SIGKILL')
          finish(failure(reason))
        }, 1000)
    }
    const cancel = () => stop('ECANCEL')
    const timeout = setTimeout(() => stop('ECANCEL'), 180000)
    signal?.addEventListener('abort', cancel, { once: true })
    const finish = (error, value) => {
      if (closed) return
      closed = true
      clearTimeout(timeout)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', cancel)
      for (const part of parts) part.fill(0)
      parts = []
      if (error) reject(error)
      else resolve(value)
    }
    child.stdout.on('data', (chunk) => {
      if (closed) {
        chunk.fill(0)
        return
      }
      bytes += chunk.length
      if (reason || bytes > prompt.bytes + 2) {
        chunk.fill(0)
        stop(reason ?? 'ENATIVEDIALOG')
        return
      }
      parts.push(Buffer.from(chunk))
    })
    child.once('error', () => finish(failure()))
    child.once('close', (code) => {
      if (reason || signal?.aborted) return finish(failure(reason ?? 'ECANCEL'))
      if (code !== 0)
        return finish(failure(code === 1 ? 'ECANCEL' : 'ENATIVEDIALOG'))
      const value = Buffer.concat(parts)
        .toString('utf8')
        .replace(/\r?\n$/, '')
      if (!value.length || Buffer.byteLength(value) > prompt.bytes)
        return finish(failure())
      finish(null, value)
    })
    // Withdrawal between the initial check and registering its listener also
    // cancels the OS process; a late exit cannot deliver a root value.
    if (signal?.aborted) cancel()
  })
}
