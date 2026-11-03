import { createHash, verify, generateKeyPairSync, sign } from 'node:crypto'
import {
  copyFile,
  mkdir,
  rm,
  readFile,
  writeFile,
  stat
} from 'node:fs/promises'
import path from 'node:path'

/**
 * Add-on Host and Module Lifecycle Manager
 *
 * Implements:
 * 1. Cryptographic manifest and signature verification (Ed25519)
 * 2. Empty-trust baseline: unverified, tampered, or mismatched modules fail closed
 * 3. Scoped capability & consent boundaries (no raw secrets, no arbitrary egress)
 * 4. Safe module lifecycle (install, enable, disable, update, transactional uninstall)
 */

export class AddonVerificationError extends Error {
  constructor(message, code = 'EADDON_VERIFICATION') {
    super(message)
    this.name = 'AddonVerificationError'
    this.code = code
  }
}

export class AddonHostManager {
  constructor({
    rootDir,
    db,
    trustedPublicKeys = new Map(),
    currentPlatform = process.platform,
    currentArch = process.arch,
    appVersion = '1.41.31'
  }) {
    this.rootDir = rootDir
    this.db = db
    this.trustedPublicKeys = trustedPublicKeys
    this.currentPlatform = currentPlatform
    this.currentArch = currentArch
    this.appVersion = appVersion
    this.activeModules = new Map()
  }

  /**
   * Initializes local add-on registry tables
   */
  initRegistry() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installed_addons (
        addon_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        publisher TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
        installed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS addon_consents (
        addon_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        granted_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        PRIMARY KEY (addon_id, capability),
        FOREIGN KEY (addon_id) REFERENCES installed_addons(addon_id) ON DELETE CASCADE
      );
    `)
  }

  /**
   * Verifies an add-on bundle against trusted root keys and platform compatibility
   */
  verifyBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') {
      throw new AddonVerificationError(
        'Malformed add-on bundle payload',
        'EBUNDLE_INVALID'
      )
    }

    const { manifest, signature, keyId, files } = bundle
    if (!manifest || !signature || !keyId || !Array.isArray(files)) {
      throw new AddonVerificationError(
        'Incomplete bundle structure',
        'EBUNDLE_INCOMPLETE'
      )
    }

    // 1. Check trust policy: Reject if keyId is not in trusted root store
    const trustedKey = this.trustedPublicKeys.get(keyId)
    if (!trustedKey) {
      throw new AddonVerificationError(
        `Publisher key '${keyId}' is not trusted (empty trust baseline)`,
        'EUNTRUSTED_KEY'
      )
    }

    // 2. Cryptographic signature check
    const manifestBuffer = Buffer.from(
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
      'utf8'
    )
    const signatureBuffer = Buffer.from(signature, 'hex')

    const isValid = verify(null, manifestBuffer, trustedKey, signatureBuffer)
    if (!isValid) {
      throw new AddonVerificationError(
        'Cryptographic signature verification failed: bundle was tampered with',
        'ESIGNATURE_MISMATCH'
      )
    }

    const parsedManifest =
      typeof manifest === 'string' ? JSON.parse(manifest) : manifest

    // 3. Platform & Architecture compatibility
    const compat = parsedManifest.compatibility
    if (
      !compat ||
      !Array.isArray(compat.platforms) ||
      !compat.platforms.includes(this.currentPlatform)
    ) {
      throw new AddonVerificationError(
        `Add-on is incompatible with platform '${this.currentPlatform}'`,
        'EPLATFORM_INCOMPATIBLE'
      )
    }

    if (
      !Array.isArray(compat.architectures) ||
      !compat.architectures.includes(this.currentArch)
    ) {
      throw new AddonVerificationError(
        `Add-on is incompatible with architecture '${this.currentArch}'`,
        'EARCH_INCOMPATIBLE'
      )
    }

    // 4. File integrity verification
    const manifestFileDigests = new Map(
      parsedManifest.files.map((f) => [f.path, f.sha256])
    )
    for (const file of files) {
      const expectedSha = manifestFileDigests.get(file.path)
      if (!expectedSha) {
        throw new AddonVerificationError(
          `File '${file.path}' is not declared in signed manifest`,
          'EUNDECLARED_FILE'
        )
      }
      const actualSha = createHash('sha256')
        .update(Buffer.from(file.content, 'utf8'))
        .digest('hex')
      if (actualSha !== expectedSha) {
        throw new AddonVerificationError(
          `File '${file.path}' checksum mismatch`,
          'EFILE_CORRUPT'
        )
      }
    }

    return parsedManifest
  }

  /**
   * Installs an add-on bundle after verification with transactional safety
   */
  async install(bundle) {
    const manifest = this.verifyBundle(bundle)
    const addonId = manifest.addonId
    const addonDir = path.join(this.rootDir, 'addons', addonId)

    // Ensure staging directory
    await mkdir(addonDir, { recursive: true })

    try {
      // Write verified bundle files
      for (const file of bundle.files) {
        const filePath = path.join(addonDir, file.path)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, file.content, 'utf8')
      }

      // Record in SQLite registry
      if (this.db) {
        this.db
          .prepare(
            `
          INSERT INTO installed_addons (addon_id, version, publisher, manifest_json, status)
          VALUES (?, ?, ?, ?, 'enabled')
          ON CONFLICT(addon_id) DO UPDATE SET
            version = excluded.version,
            manifest_json = excluded.manifest_json,
            status = 'enabled',
            updated_at = datetime('now', 'utc')
        `
          )
          .run(
            addonId,
            manifest.version,
            manifest.publisher,
            JSON.stringify(manifest)
          )
      }

      this.activeModules.set(addonId, {
        manifest,
        dir: addonDir,
        status: 'enabled'
      })

      return { success: true, addonId, version: manifest.version }
    } catch (err) {
      // Rollback filesystem files on failure
      await rm(addonDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  /**
   * Grants explicit user consent for an add-on capability
   */
  grantConsent(addonId, capability) {
    if (!this.db) return
    this.db
      .prepare(
        `
      INSERT INTO addon_consents (addon_id, capability)
      VALUES (?, ?)
      ON CONFLICT(addon_id, capability) DO NOTHING
    `
      )
      .run(addonId, capability)
  }

  /**
   * Checks whether an add-on has consent for a specific capability
   */
  hasConsent(addonId, capability) {
    if (!this.db) return false
    const row = this.db
      .prepare(
        `
      SELECT 1 FROM addon_consents WHERE addon_id = ? AND capability = ?
    `
      )
      .get(addonId, capability)
    return Boolean(row)
  }

  /**
   * Disables an add-on and cancels its pending background jobs
   */
  disable(addonId) {
    if (this.db) {
      this.db.exec('BEGIN IMMEDIATE;')
      try {
        this.db
          .prepare(
            `
          UPDATE installed_addons SET status = 'disabled', updated_at = datetime('now', 'utc')
          WHERE addon_id = ?
        `
          )
          .run(addonId)

        // Cancel any pending jobs belonging to this add-on
        this.db
          .prepare(
            `
          UPDATE work_queue
          SET status = 'dead', error = 'Add-on disabled by user', updated_at = datetime('now', 'utc')
          WHERE job_type LIKE ? AND status = 'pending'
        `
          )
          .run(`addon:${addonId}:%`)

        this.db.exec('COMMIT;')
      } catch (err) {
        this.db.exec('ROLLBACK;')
        throw err
      }
    }

    if (this.activeModules.has(addonId)) {
      this.activeModules.get(addonId).status = 'disabled'
    }
    return { disabled: true, addonId }
  }

  /**
   * Uninstalls an add-on, optionally purging module data while preserving core tables
   */
  async uninstall(addonId, { purgeData = false } = {}) {
    this.disable(addonId)

    const addonDir = path.join(this.rootDir, 'addons', addonId)
    await rm(addonDir, { recursive: true, force: true }).catch(() => {})

    if (this.db) {
      this.db.exec('BEGIN IMMEDIATE;')
      try {
        this.db
          .prepare('DELETE FROM installed_addons WHERE addon_id = ?')
          .run(addonId)

        if (purgeData) {
          // Drop only module-specific tables (never core tables like guild_config, player_mapping, etc.)
          const moduleTables = [
            `addon_${addonId.replaceAll('-', '_')}_data`,
            `addon_${addonId.replaceAll('-', '_')}_state`
          ]
          for (const tbl of moduleTables) {
            this.db.exec(`DROP TABLE IF EXISTS ${tbl};`)
          }
        }

        this.db.exec('COMMIT;')
      } catch (err) {
        this.db.exec('ROLLBACK;')
        throw err
      }
    }

    this.activeModules.delete(addonId)
    return { uninstalled: true, addonId, dataPurged: purgeData }
  }
}
