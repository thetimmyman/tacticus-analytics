import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export function nativeVault(helper, { run } = {}) {
  const lifetime = new AbortController()
  run ??= (file, request) =>
    invoke(
      file,
      request,
      request.operation === 'remove' ? undefined : lifetime.signal
    )
  async function call(operation, handle, extra = {}) {
    const result = await run(helper, { operation, handle, ...extra })
    if (result.status !== 'ok') throw new Error('Native vault unavailable')
    return result
  }
  return {
    async promptAndStoreOfficialRead({ requestedCapabilities }) {
      const handle = randomUUID()
      try {
        await call('prompt-store', handle, {
          label: `Requested access: ${requestedCapabilities.join(', ')}. Player access is mandatory for a new workspace. Cloud contribution uses separate consent.`
        })
      } catch (error) {
        await call('remove', handle).catch(() => {})
        throw error
      }
      return handle
    },
    async withOfficialRead(handle, action) {
      const result = await call('read', handle)
      try {
        if (typeof result.value !== 'string' || !result.value)
          throw new Error('Native vault unavailable')
        return await action(result.value)
      } finally {
        delete result.value
      }
    },
    async remove(handle) {
      await call('remove', handle)
    },
    async confirmPlayer({ displayName }) {
      try {
        await call('confirm-player', 'confirmation', { label: displayName })
        return true
      } catch {
        return false
      }
    },
    close() {
      lifetime.abort()
    }
  }
}

async function invoke(helper, request, signal) {
  return new Promise((accept, reject) => {
    const child = spawn(helper, [], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin' },
      ...(signal ? { signal } : { timeout: 5000 })
    })
    const chunks = []
    let bytes = 0
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 16384) child.kill('SIGKILL')
      else chunks.push(chunk)
    })
    child.once('error', () => reject(new Error('Native vault unavailable')))
    child.once('close', (code) => {
      if (code !== 0 || bytes > 16384)
        return reject(new Error('Native vault unavailable'))
      try {
        accept(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Native vault unavailable'))
      } finally {
        for (const chunk of chunks) chunk.fill(0)
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(request))
  })
}
