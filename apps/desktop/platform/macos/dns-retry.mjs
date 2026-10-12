import { lookup } from 'node:dns/promises'

const ATTEMPTS = 3
const TIMEOUT_MS = 10_000
const PAUSE_MS = 500

// Each attempt races the resolver against its own deadline so a slow DNS
// answer can never pin a later retry. Every deadline is cleared once the
// attempt settles, whether it resolved or rejected.
async function lookupOnce(resolveHost, host, timeoutMs) {
  let deadline
  try {
    return await Promise.race([
      resolveHost(host, { family: 4 }),
      new Promise((_accept, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Qualification DNS timed out')),
          timeoutMs
        )
      })
    ])
  } finally {
    clearTimeout(deadline)
  }
}

const pause = (ms) => new Promise((accept) => setTimeout(accept, ms))

export async function resolveQualificationTarget(
  host,
  {
    resolveHost = lookup,
    attempts = ATTEMPTS,
    timeoutMs = TIMEOUT_MS,
    pauseMs = PAUSE_MS
  } = {}
) {
  let lastError = new Error('Qualification DNS timed out')
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await lookupOnce(resolveHost, host, timeoutMs)
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await pause(pauseMs)
    }
  }
  throw lastError
}
