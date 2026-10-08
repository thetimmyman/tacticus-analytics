import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

export async function qualificationTarget({
  resolve = lookup,
  attempts = 3,
  timeout = 15000,
  wait = delay
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let deadline
    try {
      const target = await Promise.race([
        resolve('example.com', { family: 4 }),
        new Promise((_accept, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Qualification DNS timed out')),
            timeout
          )
        })
      ])
      if (
        isIP(target?.address ?? '') !== 4 ||
        target.address.startsWith('127.')
      )
        throw new Error('External IPv4 qualification target required')
      return target.address
    } catch {
      if (attempt + 1 === attempts)
        throw new Error('Qualification DNS target unavailable')
    } finally {
      clearTimeout(deadline)
    }
    await wait(250)
  }
  throw new Error('Qualification DNS target unavailable')
}
