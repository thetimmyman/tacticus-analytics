import { randomUUID, createHash } from 'node:crypto'

export class PortalLinkError extends Error {
  constructor(message, code = 'EPORTAL_LINK') {
    super(message)
    this.name = 'PortalLinkError'
    this.code = code
  }
}

/**
 * Validates desktop link grant from hosted TA web service.
 * Verifies that password hashes and cloud auth cookies are absent.
 */
export function validateLinkGrant(grant) {
  if (!grant || typeof grant !== 'object') {
    throw new PortalLinkError('Malformed link grant', 'EMALFORMED_GRANT')
  }

  const rawJson = JSON.stringify(grant)
  if (
    /password/i.test(rawJson) ||
    /cookie/i.test(rawJson) ||
    /refresh_token/i.test(rawJson) ||
    /service_role/i.test(rawJson)
  ) {
    throw new PortalLinkError(
      'Link grant illegally contains cloud credentials or session cookies',
      'ESECRET_LEAK'
    )
  }

  const { grantId, accountRef, authorizedGuilds, expiresAt } = grant
  if (
    !grantId ||
    !accountRef ||
    !Array.isArray(authorizedGuilds) ||
    !expiresAt
  ) {
    throw new PortalLinkError(
      'Link grant missing required fields',
      'EINVALID_GRANT_STRUCTURE'
    )
  }

  if (expiresAt < Math.floor(Date.now() / 1000)) {
    throw new PortalLinkError('Link grant has expired', 'EGRANT_EXPIRED')
  }

  return {
    grantId,
    accountRef,
    authorizedGuilds: authorizedGuilds.map((g) => ({
      guildId: g.guildId,
      guildCode: g.guildCode,
      role: g.role, // 'leader' | 'officer' | 'member'
      canManagePublishing: ['leader', 'officer'].includes(g.role)
    })),
    expiresAt
  }
}

/**
 * Manages local desktop account links and private guild portal state.
 */
export class GuildPortalManager {
  constructor(db) {
    this.db = db
    this.init()
  }

  init() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS linked_portal_accounts (
        account_ref TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        linked_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS linked_guild_authorities (
        account_ref TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        guild_code TEXT NOT NULL,
        role TEXT NOT NULL,
        can_manage_publishing INTEGER NOT NULL,
        PRIMARY KEY (account_ref, guild_id),
        FOREIGN KEY (account_ref) REFERENCES linked_portal_accounts(account_ref) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS portal_projection_views (
        guild_id TEXT PRIMARY KEY,
        collector_status TEXT NOT NULL CHECK(collector_status IN ('offline', 'idle', 'active')),
        last_collected_at TEXT,
        last_published_at TEXT,
        published_points INTEGER NOT NULL DEFAULT 0,
        published_battles INTEGER NOT NULL DEFAULT 0,
        cloud_annotations_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
    `)
  }

  /**
   * Links a TA web account via validated scoped grant.
   */
  linkAccount(grant) {
    const validated = validateLinkGrant(grant)
    if (!this.db) return validated

    this.db.exec('BEGIN IMMEDIATE;')
    try {
      this.db
        .prepare(
          `
        INSERT INTO linked_portal_accounts (account_ref, grant_id, expires_at, updated_at)
        VALUES (?, ?, ?, datetime('now', 'utc'))
        ON CONFLICT(account_ref) DO UPDATE SET
          grant_id = excluded.grant_id,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `
        )
        .run(validated.accountRef, validated.grantId, validated.expiresAt)

      this.db
        .prepare('DELETE FROM linked_guild_authorities WHERE account_ref = ?')
        .run(validated.accountRef)

      const insertAuthority = this.db.prepare(`
        INSERT INTO linked_guild_authorities (account_ref, guild_id, guild_code, role, can_manage_publishing)
        VALUES (?, ?, ?, ?, ?)
      `)

      for (const g of validated.authorizedGuilds) {
        insertAuthority.run(
          validated.accountRef,
          g.guildId,
          g.guildCode,
          g.role,
          g.canManagePublishing ? 1 : 0
        )
      }

      this.db.exec('COMMIT;')
      return validated
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }

  /**
   * Verifies if an account has server-verified permission to publish for a guild.
   */
  canPublishForGuild(accountRef, guildId) {
    if (!this.db) return false
    const row = this.db
      .prepare(
        `
      SELECT a.can_manage_publishing, p.expires_at
      FROM linked_guild_authorities a
      JOIN linked_portal_accounts p ON p.account_ref = a.account_ref
      WHERE a.account_ref = ? AND a.guild_id = ?
    `
      )
      .get(accountRef, guildId)

    if (!row) return false
    if (row.expires_at < Math.floor(Date.now() / 1000)) return false
    return Boolean(row.can_manage_publishing)
  }

  /**
   * Updates projection view with explicit freshness metrics.
   */
  updatePortalProjection(
    guildId,
    {
      collectorStatus = 'idle',
      lastCollectedAt = null,
      lastPublishedAt = null,
      publishedPoints = 0,
      publishedBattles = 0
    } = {}
  ) {
    if (!this.db) return
    this.db
      .prepare(
        `
      INSERT INTO portal_projection_views (
        guild_id, collector_status, last_collected_at, last_published_at, published_points, published_battles, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'utc'))
      ON CONFLICT(guild_id) DO UPDATE SET
        collector_status = excluded.collector_status,
        last_collected_at = coalesce(excluded.last_collected_at, portal_projection_views.last_collected_at),
        last_published_at = coalesce(excluded.last_published_at, portal_projection_views.last_published_at),
        published_points = excluded.published_points,
        published_battles = excluded.published_battles,
        updated_at = excluded.updated_at
    `
      )
      .run(
        guildId,
        collectorStatus,
        lastCollectedAt,
        lastPublishedAt,
        publishedPoints,
        publishedBattles
      )
  }

  /**
   * Reads portal projection with truthful offline/idle indication.
   */
  getPortalProjection(guildId) {
    if (!this.db) return null
    const row = this.db
      .prepare(
        `
      SELECT * FROM portal_projection_views WHERE guild_id = ?
    `
      )
      .get(guildId)

    if (!row) {
      return {
        guildId,
        collectorStatus: 'offline',
        lastCollectedAt: null,
        lastPublishedAt: null,
        publishedPoints: 0,
        publishedBattles: 0,
        cloudAnnotations: {},
        isStale: true
      }
    }

    return {
      guildId: row.guild_id,
      collectorStatus: row.collector_status,
      lastCollectedAt: row.last_collected_at,
      lastPublishedAt: row.last_published_at,
      publishedPoints: row.published_points,
      publishedBattles: row.published_battles,
      cloudAnnotations: JSON.parse(row.cloud_annotations_json),
      isStale: row.collector_status === 'offline'
    }
  }

  /**
   * Unlinks account. Revokes publishing authority while strictly preserving local SQLite data.
   */
  unlinkAccount(accountRef) {
    if (!this.db) return { unlinked: true }
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      this.db
        .prepare('DELETE FROM linked_portal_accounts WHERE account_ref = ?')
        .run(accountRef)
      this.db.exec('COMMIT;')
      return { unlinked: true, accountRef }
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }
}
