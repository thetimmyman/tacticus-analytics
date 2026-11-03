import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  validateLinkGrant,
  GuildPortalManager,
  PortalLinkError
} from '../launcher/guild-portal-link.mjs'

test('Guild Portal Link Lifecycle: Scoped Account Linking, Guild Authority, and Offline Projection', async (t) => {
  await t.test(
    'strictly rejects link grants containing passwords, refresh tokens, or session cookies',
    () => {
      const forbiddenGrants = [
        {
          grantId: 'g1',
          accountRef: 'a1',
          passwordHash: 'hash123',
          authorizedGuilds: [],
          expiresAt: 2000000000
        },
        {
          grantId: 'g1',
          accountRef: 'a1',
          cookie: 'session=xyz',
          authorizedGuilds: [],
          expiresAt: 2000000000
        },
        {
          grantId: 'g1',
          accountRef: 'a1',
          refresh_token: 'refresh123',
          authorizedGuilds: [],
          expiresAt: 2000000000
        }
      ]

      for (const grant of forbiddenGrants) {
        assert.throws(
          () => validateLinkGrant(grant),
          (err) => err instanceof PortalLinkError && err.code === 'ESECRET_LEAK'
        )
      }
    }
  )

  await t.test(
    'validates scoped grant and stores server-verified guild authority roles',
    () => {
      const db = new DatabaseSync(':memory:')
      const manager = new GuildPortalManager(db)

      const validGrant = {
        grantId: randomUUID(),
        accountRef: 'user-ref-1',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        authorizedGuilds: [
          { guildId: 'GUILD-ALPHA-UUID', guildCode: 'ALPHA', role: 'officer' },
          { guildId: 'GUILD-BETA-UUID', guildCode: 'BETA', role: 'member' }
        ]
      }

      const linked = manager.linkAccount(validGrant)
      assert.equal(linked.accountRef, 'user-ref-1')
      assert.equal(linked.authorizedGuilds.length, 2)

      // Officer has publishing authority for ALPHA
      assert.equal(
        manager.canPublishForGuild('user-ref-1', 'GUILD-ALPHA-UUID'),
        true
      )

      // Regular member does NOT have publishing management authority for BETA
      assert.equal(
        manager.canPublishForGuild('user-ref-1', 'GUILD-BETA-UUID'),
        false
      )

      // Unknown guild has zero authority
      assert.equal(
        manager.canPublishForGuild('user-ref-1', 'GUILD-GAMMA-UUID'),
        false
      )
    }
  )

  await t.test(
    'portal projection truthfully discloses offline/idle status and last publication timestamp',
    () => {
      const db = new DatabaseSync(':memory:')
      const manager = new GuildPortalManager(db)

      const nowIso = new Date().toISOString()
      manager.updatePortalProjection('GUILD-ALPHA-UUID', {
        collectorStatus: 'offline',
        lastCollectedAt: nowIso,
        lastPublishedAt: nowIso,
        publishedPoints: 25000,
        publishedBattles: 42
      })

      const projection = manager.getPortalProjection('GUILD-ALPHA-UUID')
      assert.equal(projection.collectorStatus, 'offline')
      assert.equal(projection.isStale, true)
      assert.equal(projection.publishedPoints, 25000)
      assert.equal(projection.publishedBattles, 42)
      assert.equal(projection.lastPublishedAt, nowIso)
    }
  )

  await t.test(
    'unlinking account revokes guild publishing authority while preserving local data',
    () => {
      const db = new DatabaseSync(':memory:')
      const manager = new GuildPortalManager(db)

      // Also create a local user data table to verify local data preservation
      db.exec(`
      CREATE TABLE local_player_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note TEXT NOT NULL
      );
      INSERT INTO local_player_notes (note) VALUES ('Local tactical strategy note');
    `)

      const grant = {
        grantId: randomUUID(),
        accountRef: 'user-ref-1',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        authorizedGuilds: [
          { guildId: 'GUILD-ALPHA-UUID', guildCode: 'ALPHA', role: 'leader' }
        ]
      }
      manager.linkAccount(grant)
      assert.equal(
        manager.canPublishForGuild('user-ref-1', 'GUILD-ALPHA-UUID'),
        true
      )

      // Unlink account
      manager.unlinkAccount('user-ref-1')

      // Authority is immediately revoked
      assert.equal(
        manager.canPublishForGuild('user-ref-1', 'GUILD-ALPHA-UUID'),
        false
      )

      // Local data remains completely intact
      const noteRow = db
        .prepare('SELECT note FROM local_player_notes WHERE id = 1')
        .get()
      assert.equal(noteRow.note, 'Local tactical strategy note')
    }
  )
})
