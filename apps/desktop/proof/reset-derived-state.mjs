import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

/**
 * Journeys keep their own `<state>-<suffix>` directories and insert fixed
 * synthetic control rows, so a second run would collide with the first.
 * Remove only those derived sibling directories (never `<state>` itself).
 */
export async function resetDerivedState(statePath) {
  const state = resolve(statePath)
  const prefix = `${basename(state)}-`
  const parent = dirname(state)
  const removed = []
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    await rm(resolve(parent, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  return removed
}
