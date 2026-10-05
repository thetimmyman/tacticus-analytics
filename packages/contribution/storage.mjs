import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// The native/service supervisor must provide one writer for each state file.
export class AtomicState {
  constructor(path, initial) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    try {
      this.value = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('Contribution state requires recovery')
      this.value = structuredClone(initial)
    }
  }
  commit(value) {
    const temporary = join(
      dirname(this.path),
      `.contribution-${randomUUID()}.tmp`
    )
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    const fd = openSync(temporary, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, this.path)
    const directory = openSync(dirname(this.path), 'r')
    try {
      fsyncSync(directory)
    } finally {
      closeSync(directory)
    }
    this.value = structuredClone(value)
  }
}
