import { test, describe, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import {
  LocalWorkspaceAdapter,
  LocalJobQueueAdapter,
  validateServiceBoundary
} from './local-service-adapters.mjs'

describe('Local Desktop Services, Workspace, and Job Suite', () => {
  let tempDir
  let dbPath
  let db
  let workspaceAdapter
  let jobAdapter

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-services-test-'))
    dbPath = path.join(tempDir, 'services_test.db')
    db = new DatabaseSync(dbPath)
    workspaceAdapter = new LocalWorkspaceAdapter(db)
    workspaceAdapter.initSchema()
    jobAdapter = new LocalJobQueueAdapter(db)
    jobAdapter.initSchema()
  })

  afterEach(async () => {
    if (db) {
      db.close()
    }
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('creates and reloads local workspace completely offline with zero external credentials', () => {
    const subject = randomUUID()
    const identity = {
      guildCode: 'GUILD_TITAN_01',
      guildName: 'Titans of Terra',
      playerId: 'PLAYER_COMMANDER_77',
      displayName: 'Vanguard Commander'
    }

    // 1. Create offline workspace
    const created = workspaceAdapter.createWorkspace(subject, identity)
    assert.equal(created.success, true)
    assert.equal(created.guildCode, 'GUILD_TITAN_01')
    assert.equal(created.playerId, 'PLAYER_COMMANDER_77')

    // 2. Reload workspace without cloud/auth network requests
    const loaded = workspaceAdapter.getWorkspace()
    assert.ok(loaded)
    assert.equal(loaded.subjectUserId, subject)
    assert.equal(loaded.identityMode, 'local-file')
    assert.equal(loaded.guild.guild_code, 'GUILD_TITAN_01')
    assert.equal(loaded.guild.display_name, 'Titans of Terra')
    assert.equal(loaded.player.player_id, 'PLAYER_COMMANDER_77')
    assert.equal(loaded.player.display_name, 'Vanguard Commander')
  })

  test('enqueues, prioritizes, and claims background jobs in the durable work queue', () => {
    // Enqueue two jobs with different priorities
    jobAdapter.enqueueJob({
      jobType: 'export-local-profile-data',
      jobClass: 'hook',
      payload: { target: 'backup' },
      dedupeKey: 'key-low-priority',
      priority: 2
    })

    jobAdapter.enqueueJob({
      jobType: 'refresh-explore-snapshots',
      jobClass: 'hook',
      payload: { season: 42 },
      dedupeKey: 'key-high-priority',
      priority: 8
    })

    // High priority job must be claimed first
    const claimed1 = jobAdapter.claimNextJob('worker-01')
    assert.ok(claimed1)
    assert.equal(claimed1.job_type, 'refresh-explore-snapshots')
    assert.equal(claimed1.priority, 8)
    assert.equal(claimed1.payload.season, 42)

    // Complete first job
    jobAdapter.completeJob(claimed1.id)

    // Second job claimed next
    const claimed2 = jobAdapter.claimNextJob('worker-01')
    assert.ok(claimed2)
    assert.equal(claimed2.job_type, 'export-local-profile-data')
    assert.equal(claimed2.priority, 2)
  })

  test('deduplicates active pending or processing jobs on dedupeKey', () => {
    const res1 = jobAdapter.enqueueJob({
      jobType: 'refresh-achievements',
      dedupeKey: 'dedupe-singleton-key'
    })
    assert.equal(res1.enqueued, true)

    // Attempt second enqueue with same dedupe key while first is pending
    const res2 = jobAdapter.enqueueJob({
      jobType: 'refresh-achievements',
      dedupeKey: 'dedupe-singleton-key'
    })
    assert.equal(res2.enqueued, false)
    assert.equal(res2.reason, 'DEDUPLICATED')
  })

  test('recovers dangling jobs stuck in processing following crash or machine suspend', () => {
    // Insert a job directly that simulates being claimed 10 minutes ago with 1 initial attempt
    db.prepare(
      `
      INSERT INTO work_queue (job_type, job_class, dedupe_key, status, attempts, claimed_by, claimed_at, scheduled_for)
      VALUES ('crashed-job', 'hook', 'crash-key-01', 'processing', 1, 'worker-dead', datetime('now', '-10 minutes', 'utc'), datetime('now', '-10 minutes', 'utc'))
    `
    ).run()

    // Recover dangling jobs older than 5 minutes
    const recoveredCount = jobAdapter.recoverDanglingJobs(5)
    assert.equal(recoveredCount, 1)

    // Job should now be claimable again by an active worker
    const reclaimed = jobAdapter.claimNextJob('worker-fresh')
    assert.ok(reclaimed)
    assert.equal(reclaimed.job_type, 'crashed-job')
    assert.equal(reclaimed.attempts, 2)
  })

  test('service boundary rejects browser context, forged keys, foreign origins, and DNS rebinding', () => {
    const validKey = randomBytes(32).toString('hex')

    // 1. External browser context must be rejected
    assert.throws(() => {
      validateServiceBoundary({
        origin: 'http://127.0.0.1:4000',
        host: '127.0.0.1:4000',
        transportKey: validKey,
        expectedKey: validKey,
        requestedByBrowser: true
      })
    }, /External browser context is forbidden/)

    // 2. Forged transport capability key must be rejected
    assert.throws(() => {
      validateServiceBoundary({
        origin: 'http://127.0.0.1:4000',
        host: '127.0.0.1:4000',
        transportKey: 'forged-invalid-key',
        expectedKey: validKey
      })
    }, /Invalid or missing desktop transport capability token/)

    // 3. DNS rebinding host must be rejected
    assert.throws(() => {
      validateServiceBoundary({
        origin: 'http://127.0.0.1:4000',
        host: 'evil-rebind.attack.test:4000',
        transportKey: validKey,
        expectedKey: validKey
      })
    }, /Host header violation: DNS rebinding rejected/)

    // 4. Foreign web origin must be rejected
    assert.throws(() => {
      validateServiceBoundary({
        origin: 'https://evil-attacker.test',
        host: '127.0.0.1:4000',
        transportKey: validKey,
        expectedKey: validKey
      })
    }, /Foreign origin rejected/)

    // 5. Valid local desktop call passes
    const allowed = validateServiceBoundary({
      origin: 'tauri://localhost',
      host: '127.0.0.1:4000',
      transportKey: validKey,
      expectedKey: validKey
    })
    assert.equal(allowed, true)
  })
})
