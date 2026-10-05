import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  readdirSync
} from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { cachedPersonal, PERSONAL_EXPORT_VERSION } from './personal-backup.mjs'

const limit = 4 * 1024 * 1024
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const digest = /^[a-f0-9]{64}$/
const scopes = ['Player', 'Guild', 'Guild Raid']
const statuses = new Set([
  'verified-scope',
  'expired-offline-readable',
  'vault-locked-offline-readable',
  'unavailable',
  'wrong-guild',
  'guild-binding-unavailable',
  'account-changed-offline-readable',
  'refresh-unavailable-offline-readable',
  'reconnect-required',
  'disconnected-offline-readable'
])
const incident = /^personal-incident\.[a-f0-9-]{36}\.json$/
const fail = (code, message) => Object.assign(new Error(message), { code })
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const record = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
const keys = (value, allowed) =>
  record(value) && Object.keys(value).every((key) => allowed.includes(key))
const exact = (value, allowed) =>
  keys(value, allowed) && Object.keys(value).length === allowed.length
const union = (...groups) => [...new Set(groups.flat())].sort()
const references = (snapshot) => Object.values(snapshot?.vaultReferences ?? {})
const safeGuild = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 128
const integer = (value) => Number.isSafeInteger(value) && value >= 0

function validatePersonal(value) {
  return cachedPersonal({
    schemaVersion: PERSONAL_EXPORT_VERSION,
    personal: value,
    freshness: { syncedAt: value?.upstreamUpdatedAt, offlineReadable: true }
  })
}

function validateSnapshot(value) {
  if (
    !keys(value, [
      'version',
      'status',
      'capabilities',
      'vaultReferences',
      'personal',
      'guildId',
      'raid'
    ])
  )
    throw fail('ESCHEMA', 'Invalid personal state')
  if (!Object.keys(value).length) return value
  if (
    value.version !== 1 ||
    !['setup', 'active', 'player-required', 'historical-offline'].includes(
      value.status
    )
  )
    throw fail('ESCHEMA', 'Invalid personal state version or status')
  for (const field of ['capabilities', 'vaultReferences']) {
    if (!Object.hasOwn(value, field)) continue
    if (
      !keys(value[field], scopes) ||
      Object.values(value[field]).some((entry) =>
        field === 'capabilities'
          ? !statuses.has(entry)
          : typeof entry !== 'string' || !uuid.test(entry)
      )
    )
      throw fail('ESCHEMA', 'Invalid personal capability metadata')
  }
  if (Object.hasOwn(value, 'personal')) validatePersonal(value.personal)
  if (
    ['active', 'historical-offline'].includes(value.status) &&
    !Object.hasOwn(value, 'personal')
  )
    throw fail('ESCHEMA', 'Personal snapshot unavailable')
  if (Object.hasOwn(value, 'guildId') && !safeGuild(value.guildId))
    throw fail('ESCHEMA', 'Invalid private guild metadata')
  if (
    Object.hasOwn(value, 'raid') &&
    (!exact(value.raid, ['season', 'guildId', 'syncedAt']) ||
      !integer(value.raid.season) ||
      !integer(value.raid.syncedAt) ||
      !safeGuild(value.raid.guildId))
  )
    throw fail('ESCHEMA', 'Invalid private raid metadata')
  return value
}

function handles(value) {
  return (
    Array.isArray(value) &&
    value.length <= 1024 &&
    value.every((entry) => typeof entry === 'string' && uuid.test(entry)) &&
    new Set(value).size === value.length
  )
}

function validateCheckpoint(value) {
  if (
    !exact(value, ['version', 'snapshot', 'primaryHash']) ||
    value.version !== 1 ||
    typeof value.primaryHash !== 'string' ||
    !digest.test(value.primaryHash)
  )
    throw fail('ESCHEMA', 'Invalid private personal checkpoint')
  validateSnapshot(value.snapshot)
  return value
}

function validateJournal(value) {
  if (
    !exact(value, [
      'version',
      'phase',
      'primaryHash',
      'protectedReferences',
      'retainedReferences',
      'unknownReferences'
    ]) ||
    value.version !== 1 ||
    !['pending', 'resolved'].includes(value.phase) ||
    typeof value.primaryHash !== 'string' ||
    !digest.test(value.primaryHash) ||
    !handles(value.protectedReferences) ||
    !handles(value.retainedReferences) ||
    typeof value.unknownReferences !== 'boolean' ||
    value.retainedReferences.some(
      (entry) => !value.protectedReferences.includes(entry)
    )
  )
    throw fail('ESCHEMA', 'Invalid private personal retention journal')
  return value
}

function safeInfo(descriptor) {
  const info = fstatSync(descriptor, { bigint: true })
  if (
    !info.isFile() ||
    info.uid !== BigInt(process.getuid()) ||
    info.nlink !== 1n ||
    (info.mode & 0o7777n) !== 0o600n ||
    info.size > BigInt(limit)
  )
    throw fail('EPRIVATESTATE', 'Unsafe private personal state')
  return info
}

function generation(info) {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

// Reads are bounded by descriptor, including files that grow after opening.
// Nonblocking/no-follow opening rejects devices and links without waiting.
function inspect(path, validate, primary = false) {
  let descriptor
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw fail('EPRIVATESTATE', 'Private personal state unavailable')
  }
  const bytes = Buffer.alloc(limit + 1)
  try {
    const before = safeInfo(descriptor)
    let size = 0
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, size)
      if (!count) break
      size += count
    }
    const after = safeInfo(descriptor)
    if (size > limit || generation(before) !== generation(after))
      throw fail('EPRIVATESTATE', 'Private personal state changed during read')
    const result = {
      descriptor,
      bytes: bytes.subarray(0, size),
      generation: generation(after),
      hash: hash(bytes.subarray(0, size)),
      damaged: false
    }
    try {
      result.snapshot = validate(JSON.parse(result.bytes.toString('utf8')))
    } catch {
      if (!primary)
        throw fail('EPRIVATESTATE', 'Private personal metadata unavailable')
      result.damaged = true
    }
    return result
  } catch (error) {
    bytes.fill(0)
    closeSync(descriptor)
    throw error
  }
}

function release(value) {
  if (!value) return
  value.bytes.fill(0)
  closeSync(value.descriptor)
}

function encode(value) {
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.length > limit) throw fail('ELIMIT', 'Private personal state limit')
  return bytes
}

function assertOwner(authorize) {
  if (typeof authorize !== 'function')
    throw fail('ESESSION', 'Fresh native owner authorization required')
  const result = authorize()
  if (result && typeof result.then === 'function')
    throw fail('ESESSION', 'Synchronous native owner authorization required')
}

// The native owner lock serializes writers. This adapter additionally checks
// descriptor identity, generation and hash at both mutation boundaries.
export function createPersonalStore(directory) {
  const directoryDescriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  const directoryInfo = fstatSync(directoryDescriptor)
  closeSync(directoryDescriptor)
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.uid !== process.getuid() ||
    directoryInfo.mode & 0o077
  )
    throw fail('EPRIVATESTATE', 'Private personal directory required')
  const primaryPath = join(directory, 'personal.json')
  const checkpointPath = join(directory, 'personal-checkpoint.json')
  const journalPath = join(directory, 'personal-journal.json')
  let current = {},
    currentGeneration = null,
    currentHash = null,
    stateMode = 'ready',
    checkpoint = null,
    journal = null,
    protectedReferences = [],
    retainedReferences = [],
    unknownReferences = false

  function syncDirectory() {
    const descriptor = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try {
      const info = fstatSync(descriptor)
      if (
        info.dev !== directoryInfo.dev ||
        info.ino !== directoryInfo.ino ||
        info.uid !== process.getuid() ||
        info.mode & 0o077
      )
        throw fail('EPRIVATESTATE', 'Private personal directory changed')
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  }

  // Same file-fsync / rename / directory-fsync ordering as privateState.
  // onRename is deliberately before the fallible directory durability step.
  function atomic(path, bytes, beforeRename = () => {}, onRename = () => {}) {
    const temporary = `${path}.${randomUUID()}.new`
    let descriptor
    try {
      descriptor = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      writeFileSync(descriptor, bytes)
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = undefined
      beforeRename()
      renameSync(temporary, path)
      onRename()
      syncDirectory()
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      try {
        unlinkSync(temporary)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }

  function matches(value) {
    return value
      ? value.generation === currentGeneration && value.hash === currentHash
      : currentGeneration === null && currentHash === null
  }

  function verifyUnchanged(original) {
    if (
      original &&
      generation(safeInfo(original.descriptor)) !== original.generation
    )
      throw fail('ESTALE', 'Private personal generation changed')
    const observed = inspect(primaryPath, validateSnapshot, true)
    try {
      if (
        (observed?.generation ?? null) !== (original?.generation ?? null) ||
        (observed?.hash ?? null) !== (original?.hash ?? null)
      )
        throw fail('ESTALE', 'Private personal generation changed')
    } finally {
      release(observed)
    }
  }

  function adopt(value) {
    currentGeneration = value?.generation ?? null
    currentHash = value?.hash ?? null
    if (value && !value.damaged) current = structuredClone(value.snapshot)
  }

  const initial = inspect(primaryPath, validateSnapshot, true)
  try {
    const saved = inspect(checkpointPath, validateCheckpoint)
    try {
      checkpoint = saved?.snapshot ?? null
    } finally {
      release(saved)
    }
    const pending = inspect(journalPath, validateJournal)
    try {
      journal = pending?.snapshot ?? null
    } finally {
      release(pending)
    }
    adopt(initial)
    retainedReferences = journal?.retainedReferences ?? []
    protectedReferences = union(
      references(current),
      references(checkpoint?.snapshot),
      journal?.protectedReferences ?? [],
      retainedReferences
    )
    // Retained incident evidence must not become an implicit empty reference
    // set if a separate retention journal is missing on a later restart.
    const hasIncidents = readdirSync(directory).some((name) =>
      incident.test(name)
    )
    unknownReferences = (journal?.unknownReferences ?? false) || hasIncidents
    if (
      initial?.damaged ||
      (!initial && (checkpoint || journal || hasIncidents))
    ) {
      stateMode = 'recovery-required'
      unknownReferences = true
    } else if (
      journal?.phase === 'pending' ||
      (checkpoint &&
        (checkpoint.primaryHash !== initial?.hash ||
          !isDeepStrictEqual(checkpoint.snapshot, current))) ||
      (journal &&
        (journal.primaryHash !== initial?.hash ||
          !checkpoint ||
          journal.protectedReferences.some(
            (entry) =>
              !union(references(current), retainedReferences).includes(entry)
          )))
    )
      stateMode = 'commit-uncertain'
  } finally {
    release(initial)
  }

  function ledger(phase, primaryHash, protectedHandles) {
    return validateJournal({
      version: 1,
      phase,
      primaryHash,
      protectedReferences: union(protectedHandles, retainedReferences),
      retainedReferences: [...retainedReferences],
      unknownReferences
    })
  }

  function saveJournal(value) {
    atomic(journalPath, encode(value), undefined, () => {
      journal = value
      protectedReferences = value.protectedReferences
    })
  }

  function finish(snapshot, primaryHash, retainCommitUnion = false) {
    const nextCheckpoint = validateCheckpoint({
      version: 1,
      snapshot,
      primaryHash
    })
    atomic(checkpointPath, encode(nextCheckpoint), undefined, () => {
      checkpoint = nextCheckpoint
    })
    // Keep the commit union on disk even after resolution: the last journal
    // rename can be visible before a directory-fsync failure. A fresh owner
    // reconciliation may trim it after syncing the observed primary generation.
    saveJournal(
      ledger(
        'resolved',
        primaryHash,
        retainCommitUnion ? protectedReferences : references(snapshot)
      )
    )
    stateMode = 'ready'
  }

  function commit(snapshot, original, authorize, preserve) {
    const bytes = encode(snapshot),
      nextHash = hash(bytes)
    // Checkpoint wrapping also consumes bounded space; reject that limit
    // before any primary mutation rather than leave an unrepairable commit.
    encode(validateCheckpoint({ version: 1, snapshot, primaryHash: nextHash }))
    let visible = false
    verifyUnchanged(original)
    assertOwner(authorize)
    protectedReferences = union(protectedReferences, references(snapshot))
    // Until all three durable records agree, destructive cleanup stays paused.
    stateMode = preserve ? 'recovery-required' : 'commit-uncertain'
    saveJournal(ledger('pending', nextHash, protectedReferences))
    if (preserve) preserve()
    try {
      atomic(
        primaryPath,
        bytes,
        () => {
          verifyUnchanged(original)
          assertOwner(authorize)
        },
        () => {
          visible = true
          current = structuredClone(snapshot)
          currentGeneration = null
          currentHash = nextHash
          stateMode = 'commit-uncertain'
        }
      )
      const replaced = inspect(primaryPath, validateSnapshot, true)
      try {
        if (!replaced || replaced.damaged || replaced.hash !== nextHash)
          throw fail('ESTALE', 'Committed personal generation unavailable')
        adopt(replaced)
      } finally {
        release(replaced)
      }
      finish(snapshot, nextHash, true)
      return stateMode
    } catch (error) {
      if (!visible) throw error
      // A visible replacement is authoritative even when its durability or
      // checkpoint is uncertain. Never surface this as a failed precommit.
      stateMode = 'commit-uncertain'
      return stateMode
    } finally {
      bytes.fill(0)
    }
  }

  function incidentQuota(bytes) {
    let count = 0,
      total = 0
    for (const name of readdirSync(directory)) {
      if (!incident.test(name)) continue
      const retained = inspect(join(directory, name), (value) => value, true)
      try {
        count++
        total += retained.bytes.length
      } finally {
        release(retained)
      }
    }
    if (count >= 3 || total + bytes > 3 * limit)
      throw fail('ELIMIT', 'Private personal incident retention limit')
  }

  function preserveOriginal(original) {
    if (!original) return
    const path = join(directory, `personal-incident.${randomUUID()}.json`)
    const descriptor = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    try {
      writeFileSync(descriptor, original.bytes)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    syncDirectory()
  }

  function restore(personal, authorize) {
    // Candidate projection validation precedes authorization and all mutation.
    const validated = validatePersonal(personal)
    if (stateMode !== 'recovery-required')
      throw fail('ERESTORE', 'Personal restore requires damaged retained state')
    assertOwner(authorize)
    const original = inspect(primaryPath, validateSnapshot, true)
    try {
      if (!matches(original))
        throw fail('ESTALE', 'Private personal generation changed')
      if (original && !original.damaged)
        throw fail('ERESTORE', 'Valid personal state cannot be replaced')
      if (original) incidentQuota(original.bytes.length)
      retainedReferences = union(
        retainedReferences,
        protectedReferences,
        references(checkpoint?.snapshot)
      )
      unknownReferences = true
      return commit(
        {
          version: 1,
          status: 'historical-offline',
          capabilities: Object.fromEntries(
            scopes.map((scope) => [scope, 'reconnect-required'])
          ),
          vaultReferences: {},
          personal: structuredClone(validated)
        },
        original,
        authorize,
        () => preserveOriginal(original)
      )
    } finally {
      release(original)
    }
  }

  return {
    read() {
      if (stateMode === 'recovery-required')
        throw fail('ERECOVERY', 'Personal cache recovery required')
      return structuredClone(current)
    },
    write(snapshot, authorize) {
      validateSnapshot(snapshot)
      const next = JSON.parse(encode(snapshot).toString('utf8'))
      validateSnapshot(next)
      if (stateMode === 'recovery-required')
        throw fail('ERECOVERY', 'Personal cache recovery required')
      if (stateMode !== 'ready')
        throw fail('ECOMMITUNCERTAIN', 'Fresh personal reconciliation required')
      assertOwner(authorize)
      const original = inspect(primaryPath, validateSnapshot, true)
      try {
        if (original?.damaged) {
          adopt(original)
          unknownReferences = true
          stateMode = 'recovery-required'
          throw fail('ERECOVERY', 'Personal cache recovery required')
        }
        if (!matches(original))
          throw fail('ESTALE', 'Private personal generation changed')
        return commit(next, original, authorize)
      } finally {
        release(original)
      }
    },
    mode: () => stateMode,
    cleanupReferences: () =>
      stateMode !== 'ready' || unknownReferences
        ? null
        : union(references(current), retainedReferences),
    checkpointAvailable: () => Boolean(checkpoint?.snapshot.personal),
    reconcile(authorize) {
      assertOwner(authorize)
      const observed = inspect(primaryPath, validateSnapshot, true)
      try {
        if (observed?.damaged || (!observed && (checkpoint || journal))) {
          adopt(observed)
          stateMode = 'recovery-required'
          unknownReferences = true
          return stateMode
        }
        if (!observed) return stateMode
        adopt(observed)
        stateMode = 'commit-uncertain'
        protectedReferences = union(protectedReferences, references(current))
        verifyUnchanged(observed)
        assertOwner(authorize)
        saveJournal(ledger('pending', observed.hash, protectedReferences))
        try {
          verifyUnchanged(observed)
          assertOwner(authorize)
          finish(current, observed.hash)
          return stateMode
        } catch {
          stateMode = 'commit-uncertain'
          return stateMode
        }
      } finally {
        release(observed)
      }
    },
    restorePersonal: restore,
    restoreCheckpoint(authorize) {
      if (!checkpoint?.snapshot.personal)
        throw fail('ECHECKPOINT', 'Private personal checkpoint unavailable')
      return restore(checkpoint.snapshot.personal, authorize)
    }
  }
}
