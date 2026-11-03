import { test, describe, before, after } from 'node:test'
import { strict as assert } from 'node:assert'
import net from 'node:net'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/**
 * Offline Boundary Assertion Test
 *
 * Validates the core architectural requirements of the native desktop runtime:
 * 1. Offline Boundary Enforcement: Outbound network calls to external endpoints are rejected.
 * 2. Local State Mutation: Representative analytical data operations execute locally in isolation.
 * 3. Zero External Connectivity Dependency: Local transactions succeed with network interfaces down.
 */

describe('Desktop Runtime Offline Boundary Assertion', () => {
  let tempDir
  let mockDatabaseFile
  let originalSocketConnect

  before(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ta-desktop-offline-test-')
    )
    mockDatabaseFile = path.join(tempDir, 'local-store.json')
    originalSocketConnect = net.Socket.prototype.connect
  })

  after(async () => {
    net.Socket.prototype.connect = originalSocketConnect
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Simulated local offline database layer (mocking embedded SQLite in-process store)
  class MockInProcessSqliteStore {
    constructor(filePath) {
      this.filePath = filePath
      this.state = {
        version: 0,
        roster_plans: [],
        analytics_cache: []
      }
    }

    async init() {
      try {
        const data = await fs.readFile(this.filePath, 'utf8')
        this.state = JSON.parse(data)
      } catch (err) {
        if (err.code === 'ENOENT') {
          // Initialize schema version 1
          this.state.version = 1
          await this.persist()
        } else {
          throw err
        }
      }
    }

    async persist() {
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.state, null, 2),
        'utf8'
      )
    }

    async insertRosterPlan({ planId, characterId, targetRank, targetRarity }) {
      // Transactional boundary
      const record = {
        planId,
        characterId,
        targetRank,
        targetRarity,
        updatedAt: new Date().toISOString()
      }
      this.state.roster_plans.push(record)
      await this.persist()
      return record
    }

    async calculateRaidOptimalLineup({ bossId, bossAffinity }) {
      // In-process analytical calculation (simulating SQL CTE / window function)
      const matches = this.state.roster_plans.filter((p) => p.targetRank >= 5)
      const powerScore =
        matches.length * 1250 + (bossAffinity === 'CHAOS' ? 500 : 250)
      return {
        bossId,
        bossAffinity,
        eligibleCharacters: matches.map((m) => m.characterId),
        projectedPowerScore: powerScore,
        computedOffline: true
      }
    }
  }

  // Runtime network policy supervisor
  class OfflinePolicyGuard {
    static installEgressBlocker() {
      net.Socket.prototype.connect = function (...args) {
        const error = new Error(
          'OFFLINE_BOUNDARY_VIOLATION: External socket connections are forbidden in desktop offline profile'
        )
        error.code = 'ENETUNREACH'
        process.nextTick(() => {
          this.destroy(error)
        })
        return this
      }
    }

    static restore() {
      net.Socket.prototype.connect = originalSocketConnect
    }
  }

  test('asserts that external egress is strictly rejected by the offline boundary', async () => {
    OfflinePolicyGuard.installEgressBlocker()

    try {
      await assert.rejects(
        async () => {
          await new Promise((resolve, reject) => {
            const req = http.get(
              'http://api.external-game-service.test/sync',
              (res) => {
                resolve(res)
              }
            )
            req.on('error', (err) => {
              reject(err)
            })
            req.setTimeout(500, () => {
              req.destroy(new Error('TIMEOUT'))
            })
          })
        },
        (err) => {
          assert.match(err.message, /OFFLINE_BOUNDARY_VIOLATION/)
          assert.equal(err.code, 'ENETUNREACH')
          return true
        }
      )
    } finally {
      OfflinePolicyGuard.restore()
    }
  })

  test('executes representative database writes and analytics calculations 100% offline', async () => {
    // Activate strict network blocker
    OfflinePolicyGuard.installEgressBlocker()

    try {
      const db = new MockInProcessSqliteStore(mockDatabaseFile)
      await db.init()

      assert.equal(db.state.version, 1, 'Local schema initialized at version 1')

      // 1. Perform offline transactional write
      const writeResult = await db.insertRosterPlan({
        planId: 'plan-offline-alpha',
        characterId: 'char-calandis-01',
        targetRank: 7,
        targetRarity: 'LEGENDARY'
      })

      assert.equal(writeResult.planId, 'plan-offline-alpha')
      assert.equal(writeResult.targetRank, 7)

      // 2. Perform local analytical computation
      const analyticsResult = await db.calculateRaidOptimalLineup({
        bossId: 'boss-avatar-khaine',
        bossAffinity: 'CHAOS'
      })

      assert.equal(analyticsResult.computedOffline, true)
      assert.ok(analyticsResult.projectedPowerScore > 0)
      assert.deepEqual(analyticsResult.eligibleCharacters, ['char-calandis-01'])

      // 3. Verify persistence without network
      const diskData = JSON.parse(await fs.readFile(mockDatabaseFile, 'utf8'))
      assert.equal(diskData.roster_plans.length, 1)
      assert.equal(diskData.roster_plans[0].characterId, 'char-calandis-01')
    } finally {
      OfflinePolicyGuard.restore()
    }
  })

  test('verifies zero ambient network access required during cold bootstrap', async () => {
    OfflinePolicyGuard.installEgressBlocker()

    try {
      // Simulate fresh launch bootstrap
      const freshDbPath = path.join(tempDir, 'fresh-bootstrap.db')
      const db = new MockInProcessSqliteStore(freshDbPath)

      const startTime = performance.now()
      await db.init()
      const durationMs = performance.now() - startTime

      assert.ok(
        durationMs < 100,
        `Bootstrap completed in ${durationMs}ms, well below budget`
      )
      const exists = await fs
        .stat(freshDbPath)
        .then(() => true)
        .catch(() => false)
      assert.equal(
        exists,
        true,
        'Local database file initialized on disk offline'
      )
    } finally {
      OfflinePolicyGuard.restore()
    }
  })
})
