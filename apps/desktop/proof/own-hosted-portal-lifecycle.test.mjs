import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  OwnHostedPortalManager,
  OwnHostedPortalError
} from '../launcher/own-hosted-portal.mjs'

test('Own-Hosted Portal Boundary: Default Closed, Route Isolation, TLS Guard & Teardown', async (t) => {
  function setupPortal() {
    const db = new DatabaseSync(':memory:')
    const portal = new OwnHostedPortalManager({ db })
    return { db, portal }
  }

  await t.test(
    'default installation has zero network listeners or open sockets',
    () => {
      const { portal } = setupPortal()
      assert.equal(portal.mode, 'disabled')
      assert.equal(portal.server, null)
      assert.equal(portal.port, null)
    }
  )

  await t.test(
    'refuses private-lan exposure without explicit TLS configuration',
    async () => {
      const { portal } = setupPortal()

      await assert.rejects(
        portal.enablePortal({ mode: 'private-lan', allowedGuildId: 'GUILD-A' }),
        (err) =>
          err instanceof OwnHostedPortalError && err.code === 'ETLS_REQUIRED'
      )
    }
  )

  await t.test(
    'serves authorized guest requests and strictly rejects privileged local-owner routes',
    async () => {
      const { portal } = setupPortal()

      const started = await portal.enablePortal({
        mode: 'loopback-only',
        allowedGuildId: 'GUILD-A'
      })
      assert.equal(started.enabled, true)
      assert.ok(started.port > 0)

      const token = portal.issueGuestSession('GUILD-A', 'member-1', 'member')
      const baseUrl = `http://127.0.0.1:${started.port}`

      // 1. Authorized guest endpoint
      const infoRes = await fetch(`${baseUrl}/portal/guild-info`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      assert.equal(infoRes.status, 200)
      const infoBody = await infoRes.json()
      assert.equal(infoBody.guildId, 'GUILD-A')
      assert.equal(infoBody.sanitized, true)

      // 2. Cross-guild access attempt rejected with 403
      const crossGuildRes = await fetch(
        `${baseUrl}/portal/war-summary?guildId=GUILD-B`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      assert.equal(crossGuildRes.status, 403)

      // 3. Privileged local-owner routes unconditionally rejected with 403
      const forbiddenPaths = ['/admin', '/desktop', '/vault', '/db', '/broker']
      for (const p of forbiddenPaths) {
        const res = await fetch(`${baseUrl}${p}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        assert.equal(res.status, 403)
        const body = await res.json()
        assert.match(body.error, /forbidden via portal surface/)
      }

      await portal.disablePortal()
    }
  )

  await t.test(
    'disabling portal tears down listener, invalidates sessions, and preserves local database',
    async () => {
      const { db, portal } = setupPortal()

      // Add local user data
      db.exec(`
      CREATE TABLE local_secret_notes (
        id INTEGER PRIMARY KEY,
        note TEXT NOT NULL
      );
      INSERT INTO local_secret_notes (id, note) VALUES (1, 'Sensitive local player plan');
    `)

      const started = await portal.enablePortal({
        mode: 'loopback-only',
        allowedGuildId: 'GUILD-A'
      })
      const token = portal.issueGuestSession('GUILD-A', 'member-1')

      // Disable portal
      const disableResult = await portal.disablePortal()
      assert.equal(disableResult.disabled, true)
      assert.equal(disableResult.localDataPreserved, true)
      assert.equal(portal.server, null)
      assert.equal(portal.mode, 'disabled')

      // Requests now fail (port closed)
      await assert.rejects(
        fetch(`http://127.0.0.1:${started.port}/portal/guild-info`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      )

      // Local database is completely intact
      const note = db
        .prepare('SELECT note FROM local_secret_notes WHERE id = 1')
        .get()
      assert.equal(note.note, 'Sensitive local player plan')
    }
  )
})
