import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn()
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({ error: mockLoggerError })
}))

import {
  AUDITABLE_GUILD_CONFIG_FIELDS,
  diffGuildConfig,
  logGuildConfigChange
} from '@/app/lib/audit/log-guild-config-change'

function createAuditDb(insertResult: unknown = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult)
  const from = vi.fn((table: string) => {
    if (table !== 'audit_logs') {
      throw new Error(`Unexpected table ${table}`)
    }
    return { insert }
  })
  return { db: { from }, from, insert }
}

afterEach(() => {
  vi.restoreAllMocks()
  mockLoggerError.mockClear()
})

describe('AUDITABLE_GUILD_CONFIG_FIELDS', () => {
  it('excludes secret-material columns from the guild-config snapshot projection', () => {
    for (const field of ['api_key_encrypted', 'session_id', 'client_secret']) {
      expect(AUDITABLE_GUILD_CONFIG_FIELDS).not.toContain(field)
    }
  })
})

describe('diffGuildConfig', () => {
  it('diffs only supplied auditable fields and normalizes missing values to null', () => {
    expect(
      diffGuildConfig(
        {
          enabled: true,
          theme_preset: 'EOT',
          ignored_field: 'old'
        },
        {
          enabled: false,
          ignored_field: 'new'
        }
      )
    ).toEqual({
      enabled: { old: true, new: false }
    })
  })

  it('can diff a narrowed field list for scoped callers', () => {
    expect(
      diffGuildConfig(
        { enabled: true, theme_preset: 'EOT' },
        { enabled: false, theme_preset: 'default' },
        ['theme_preset']
      )
    ).toEqual({
      theme_preset: { old: 'EOT', new: 'default' }
    })
  })
})

describe('logGuildConfigChange', () => {
  it('writes one guild_config_update audit row for changed fields', async () => {
    const { db, from, insert } = createAuditDb()

    await expect(
      logGuildConfigChange({
        db: db as never,
        userId: 'user-123',
        guildCode: 'EOT',
        before: { enabled: true, theme_preset: 'EOT' },
        after: { enabled: false, theme_preset: 'default' },
        ip: '203.0.113.10',
        userAgent: 'vitest'
      })
    ).resolves.toBe(true)

    expect(from).toHaveBeenCalledWith('audit_logs')
    expect(insert).toHaveBeenCalledWith({
      action: 'guild_config_update',
      user_id: 'user-123',
      details: {
        guild_code: 'EOT',
        changes: {
          enabled: { old: true, new: false },
          theme_preset: { old: 'EOT', new: 'default' }
        }
      },
      ip_address: '203.0.113.10',
      user_agent: 'vitest'
    })
  })

  it('does not write an audit row for no-op updates', async () => {
    const { db, insert } = createAuditDb()

    await expect(
      logGuildConfigChange({
        db: db as never,
        userId: 'user-123',
        guildCode: 'EOT',
        before: { enabled: true },
        after: { enabled: true }
      })
    ).resolves.toBe(false)

    expect(insert).not.toHaveBeenCalled()
  })

  it('swallows insert failures so guild settings saves are not blocked', async () => {
    const { db } = createAuditDb({ error: { message: 'RLS denied' } })

    await expect(
      logGuildConfigChange({
        db: db as never,
        userId: null,
        guildCode: 'EOT',
        before: { enabled: true },
        after: { enabled: false }
      })
    ).resolves.toBe(false)

    expect(mockLoggerError).toHaveBeenCalledWith(
      {
        guildCode: 'EOT',
        err: { message: 'RLS denied' }
      },
      'Failed to write guild-config audit row'
    )
  })

  it('swallows thrown audit-client errors', async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error('network down')
      })
    }

    await expect(
      logGuildConfigChange({
        db: db as never,
        userId: null,
        guildCode: 'EOT',
        before: { enabled: true },
        after: { enabled: false }
      })
    ).resolves.toBe(false)

    expect(mockLoggerError).toHaveBeenCalledWith(
      {
        guildCode: 'EOT',
        err: expect.objectContaining({ message: 'network down' })
      },
      'Unexpected guild-config audit failure'
    )
  })
})
