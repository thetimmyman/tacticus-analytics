import { describe, expect, it } from 'vitest'
import {
  isBombAlertDirty,
  parseHeraldSettingsRow,
  validateBombAlert,
  validateDefaultHeraldRole
} from '@/app/(dashboard)/guild-management/settings/herald-notification-model'

describe('Herald notification settings model', () => {
  it('parses database values while keeping the webhook write-only', () => {
    const parsed = parseHeraldSettingsRow({
      notifications_enabled: false,
      defeat_alerts_enabled: true,
      bomb_alert_overkill_threshold: '0.75',
      bomb_alert_role_id: '12345678901234567',
      bomb_alert_webhook_url: 'https://discord.com/api/webhooks/secret',
      guild_level: 42,
      bomb_alert_calculation_mode: 'average',
      herald_default_role_id: '98765432109876543'
    })

    expect(parsed.toggles.notificationsEnabled).toBe(false)
    expect(parsed.bombAlert).toMatchObject({
      overkillPercent: '75',
      webhookUrl: '',
      guildLevel: '42',
      calculationMode: 'average'
    })
    expect(parsed.defaultRole.roleId).toBe('98765432109876543')
  })

  it('builds a write payload without clearing a hidden webhook by default', () => {
    const alert = {
      overkillPercent: '80',
      roleId: '',
      webhookUrl: '',
      guildLevel: '40',
      calculationMode: 'worst_case' as const
    }
    const keep = validateBombAlert(alert, false, '2026-08-18T00:00:00Z')
    const clear = validateBombAlert(alert, true, '2026-08-18T00:00:00Z')

    expect(keep.ok && keep.value).not.toHaveProperty('bomb_alert_webhook_url')
    expect(clear.ok && clear.value).toHaveProperty(
      'bomb_alert_webhook_url',
      null
    )
  })

  it('rejects invalid thresholds, webhooks, levels, and role ids', () => {
    const baseline = {
      overkillPercent: '80',
      roleId: '',
      webhookUrl: '',
      guildLevel: '',
      calculationMode: 'worst_case' as const
    }

    expect(
      validateBombAlert({ ...baseline, overkillPercent: '49' }, false, '').ok
    ).toBe(false)
    expect(
      validateBombAlert(
        { ...baseline, webhookUrl: 'https://example.com/hook' },
        false,
        ''
      ).ok
    ).toBe(false)
    expect(
      validateBombAlert({ ...baseline, guildLevel: '101' }, false, '').ok
    ).toBe(false)
    expect(validateDefaultHeraldRole('123').ok).toBe(false)
  })

  it('tracks explicit webhook clearing as a dirty change', () => {
    const baseline = {
      overkillPercent: '80',
      roleId: '',
      webhookUrl: '',
      guildLevel: '',
      calculationMode: 'worst_case' as const
    }

    expect(isBombAlertDirty(baseline, baseline, false)).toBe(false)
    expect(isBombAlertDirty(baseline, baseline, true)).toBe(true)
  })
})
