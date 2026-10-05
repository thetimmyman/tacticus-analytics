import { test, after } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import {
  mkdtemp,
  readFile,
  readdir,
  chmod,
  symlink,
  writeFile,
  rm,
  stat
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialVault } from '../launcher/credential-vault.mjs'

const roots = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-vault-'))
  roots.push(root)
  const key = randomBytes(32)
  const state = {
    consent: true,
    backend: 'gnome_libsecret',
    available: true,
    queries: 0
  }
  const storage = {
    isEncryptionAvailable() {
      state.queries++
      return state.available
    },
    getSelectedStorageBackend() {
      return state.backend
    },
    encryptString(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final()
      ])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([
        cipher.update(value.subarray(28)),
        cipher.final()
      ]).toString('utf8')
    }
  }
  const directory = join(root, 'vault')
  const vault = new CredentialVault({
    safeStorage: storage,
    directory,
    consent: () => state.consent
  })
  return {
    root,
    directory,
    vault,
    state,
    storage,
    secret: randomBytes(32).toString('hex')
  }
}
const denied = {
  code: 'EVAULT',
  message:
    'Secure credential storage is unavailable or permission was withdrawn.'
}

test('consent precedes OS provider access and all storage creation', async () => {
  const f = await fixture()
  f.state.consent = false
  await assert.rejects(f.vault.save(f.secret), denied)
  assert.equal(f.state.queries, 0)
  await assert.rejects(stat(f.directory), { code: 'ENOENT' })
})
test('basic text, unknown providers, unavailable encryption and unverified platforms fail closed', async () => {
  const f = await fixture()
  for (const backend of ['basic_text', 'unknown', 'unrecognized']) {
    f.state.backend = backend
    await assert.rejects(f.vault.save(f.secret), denied)
  }
  f.state.backend = 'gnome_libsecret'
  f.state.available = false
  await assert.rejects(f.vault.save(f.secret), denied)
  f.state.available = true
  for (const platform of ['win32', 'darwin']) {
    const vault = new CredentialVault({
      safeStorage: f.storage,
      directory: f.directory,
      consent: () => true,
      platform
    })
    await assert.rejects(vault.save(f.secret), denied)
  }
  await assert.rejects(stat(f.directory), { code: 'ENOENT' })
})
test('opaque private records support fixed trusted operations and cleanup after consent withdrawal', async () => {
  const f = await fixture(),
    handle = await f.vault.save(f.secret)
  assert.match(handle, /^[a-f0-9]{32}$/)
  const path = join(f.directory, `${handle}.secret`)
  assert.equal((await readFile(path)).includes(Buffer.from(f.secret)), false)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700)
  assert.deepEqual(
    await f.vault.withCredential(handle, (value) => ({
      matched: value === f.secret
    })),
    { matched: true }
  )
  await assert.rejects(
    f.vault.withCredential(handle, (value) => ({ accidentallyEchoed: value })),
    denied
  )
  f.state.consent = false
  await assert.rejects(
    f.vault.withCredential(handle, () => assert.fail('Must not execute')),
    denied
  )
  await f.vault.forget(handle)
  await f.vault.forget(handle)
  assert.deepEqual(await readdir(f.directory), [])
})
test('withdrawal before decryption or during the operation prevents a result', async () => {
  const f = await fixture(),
    handle = await f.vault.save(f.secret)
  await assert.rejects(
    f.vault.withCredential(handle, () => {
      f.state.consent = false
      return { completed: true }
    }),
    denied
  )
  f.state.consent = true
  const decrypt = f.storage.decryptString
  f.storage.decryptString = (value) => {
    f.state.consent = false
    return decrypt(value)
  }
  await assert.rejects(
    f.vault.withCredential(handle, () => assert.fail('Must not execute')),
    denied
  )
})
test('tampering, links, permissive files, oversized records and invalid handles never reach an operation', async () => {
  const f = await fixture(),
    handle = await f.vault.save(f.secret),
    path = join(f.directory, `${handle}.secret`)
  const operation = () => assert.fail('Must not execute')
  for (const invalid of ['../secret', null, 'z'.repeat(32)])
    await assert.rejects(f.vault.withCredential(invalid, operation), denied)
  await chmod(path, 0o644)
  await assert.rejects(f.vault.withCredential(handle, operation), denied)
  await chmod(path, 0o600)
  await writeFile(path, randomBytes(100))
  await assert.rejects(f.vault.withCredential(handle, operation), denied)
  await writeFile(path, Buffer.alloc(65537))
  await assert.rejects(f.vault.withCredential(handle, operation), denied)
  await rm(path)
  await symlink(join(f.root, 'outside'), path)
  await assert.rejects(f.vault.withCredential(handle, operation), denied)
})
test('provider errors are redacted and plaintext providers cannot persist a record', async () => {
  const f = await fixture()
  f.storage.encryptString = () => {
    throw new Error(f.secret)
  }
  await assert.rejects(f.vault.save(f.secret), denied)
  f.storage.encryptString = (value) => Buffer.from(value)
  await assert.rejects(f.vault.save(f.secret), denied)
  await assert.rejects(stat(f.directory), { code: 'ENOENT' })
})
test('withdrawal while persisting removes the new record', async () => {
  const f = await fixture()
  let count = 0
  const vault = new CredentialVault({
    safeStorage: f.storage,
    directory: f.directory,
    consent: () => ++count < 4
  })
  await assert.rejects(vault.save(f.secret), denied)
  assert.deepEqual(await readdir(f.directory), [])
})

test('a locked provider refuses decryption while retaining the encrypted record for retry', async () => {
  const f = await fixture(),
    handle = await f.vault.save(f.secret),
    path = join(f.directory, `${handle}.secret`)
  const before = await readFile(path)
  f.state.available = false
  await assert.rejects(
    f.vault.withCredential(handle, () => assert.fail('Must not execute')),
    denied
  )
  assert.deepEqual(await readFile(path), before)
  f.state.available = true
  assert.deepEqual(
    await f.vault.withCredential(handle, (value) => ({
      matched: value === f.secret
    })),
    { matched: true }
  )
})
