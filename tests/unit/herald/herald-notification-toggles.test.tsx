// The load SELECT must never name the withheld bomb_alert_webhook_url, and a blank
// field means "keep it", so saving must not write that column.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

interface UpdateOptions {
  count?: 'exact' | 'planned' | 'estimated'
}

const mocks = vi.hoisted(() => ({
  selectCalls: [] as string[],
  updates: [] as {
    table: string
    payload: Record<string, unknown>
    options: UpdateOptions | undefined
  }[],
  loadRow: {} as Record<string, unknown> | null,
  loadError: null as null | { message: string },
  updateError: null as null | { message: string },
  // The component rejects any save that did not touch exactly one row.
  updateCount: 1 as number | null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  }
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        mocks.selectCalls.push(columns)
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: mocks.loadError ? null : mocks.loadRow,
              error: mocks.loadError
            })
          })
        }
      },
      update: (payload: Record<string, unknown>, options?: UpdateOptions) => ({
        eq: async () => {
          mocks.updates.push({ table, payload, options })
          return {
            error: mocks.updateError,
            count: mocks.updateError ? null : mocks.updateCount
          }
        }
      })
    })
  })
}))

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast })
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

import { HeraldNotificationToggles } from '@/app/(dashboard)/guild-management/settings/HeraldNotificationToggles'

const renderPanel = async () => {
  render(
    <HeraldNotificationToggles guildCode="TESTGUILD" canManage className="" />
  )
  await waitFor(() => expect(mocks.selectCalls.length).toBeGreaterThan(0))
  await waitFor(() =>
    expect(screen.queryByText(/Loading current settings/)).toBeNull()
  )
}

beforeEach(() => {
  mocks.selectCalls.length = 0
  mocks.updates.length = 0
  mocks.loadRow = {}
  mocks.loadError = null
  mocks.updateError = null
  mocks.updateCount = 1
  mocks.toast.success.mockReset()
  mocks.toast.error.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('HeraldNotificationToggles (column whitelist)', () => {
  it('loads guild_config without naming the withheld bomb_alert_webhook_url column', async () => {
    await renderPanel()

    const select = mocks.selectCalls[0]!
    expect(select).not.toContain('bomb_alert_webhook_url')
    expect(select).toContain('herald_default_role_id')
    expect(select).toContain('bomb_alert_role_id')
  })

  it('saves the default Herald role via a bare update (no representation needed)', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.type(
      screen.getByLabelText(/Role ID \(blank = no fallback\)/i),
      '123456789012345678'
    )
    await user.click(screen.getByRole('button', { name: /Save default role/i }))

    await waitFor(() => expect(mocks.updates.length).toBe(1))
    expect(mocks.updates[0]).toEqual({
      table: 'guild_config',
      payload: { herald_default_role_id: '123456789012345678' },
      options: { count: 'exact' }
    })
    expect(mocks.toast.success).toHaveBeenCalled()
  })

  it('fails closed when the settings load errors: banner shown, saves disabled (F1)', async () => {
    mocks.loadError = { message: 'permission denied for table guild_config' }
    render(
      <HeraldNotificationToggles guildCode="TESTGUILD" canManage className="" />
    )
    await waitFor(() => expect(mocks.selectCalls.length).toBeGreaterThan(0))
    await waitFor(() =>
      expect(screen.queryByText(/Loading current settings/)).toBeNull()
    )

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain(
      'Could not load the current Herald settings'
    )
    expect(banner.textContent).toContain(
      'permission denied for table guild_config'
    )

    // No save affordance, so on-screen defaults cannot overwrite real config.
    expect(
      screen.queryByRole('button', { name: /Save default role/i })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Save bomb-alert settings/i })
    ).toBeNull()

    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toBeDisabled()
    }
    expect(mocks.updates.length).toBe(0)
  })

  it('treats a zero-row update as a failure, not a success (F2)', async () => {
    const user = userEvent.setup()
    await renderPanel()
    mocks.updateCount = 0

    await user.type(
      screen.getByLabelText(/Role ID \(blank = no fallback\)/i),
      '123456789012345678'
    )
    await user.click(screen.getByRole('button', { name: /Save default role/i }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(String(mocks.toast.error.mock.calls[0]![1])).toContain(
      'Nothing was saved'
    )
  })

  it('omits bomb_alert_webhook_url from the bomb-alert save when the field is untouched', async () => {
    const user = userEvent.setup()
    await renderPanel()

    const overkill = screen.getByLabelText(/Overkill threshold/i)
    await user.clear(overkill)
    await user.type(overkill, '90')
    await user.click(
      screen.getByRole('button', { name: /Save bomb-alert settings/i })
    )

    await waitFor(() => expect(mocks.updates.length).toBe(1))
    const payload = mocks.updates[0]!.payload
    expect(payload).not.toHaveProperty('bomb_alert_webhook_url')
    expect(payload.bomb_alert_overkill_threshold).toBe(0.9)
  })

  it('sends bomb_alert_webhook_url: null only via the explicit clear action', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(
      screen.getByRole('button', { name: /Clear saved webhook/i })
    )
    await user.click(
      screen.getByRole('button', { name: /Save bomb-alert settings/i })
    )

    await waitFor(() => expect(mocks.updates.length).toBe(1))
    expect(mocks.updates[0]!.payload.bomb_alert_webhook_url).toBeNull()
  })

  it('replaces the webhook when the user types a new URL', async () => {
    const user = userEvent.setup()
    await renderPanel()

    // PLACEHOLDER keeps this in the secret scanner's exemption yet passes URL validation.
    await user.type(
      screen.getByLabelText(/Webhook URL/i),
      'https://discord.com/api/webhooks/1/PLACEHOLDER'
    )
    await user.click(
      screen.getByRole('button', { name: /Save bomb-alert settings/i })
    )

    await waitFor(() => expect(mocks.updates.length).toBe(1))
    expect(mocks.updates[0]!.payload.bomb_alert_webhook_url).toBe(
      'https://discord.com/api/webhooks/1/PLACEHOLDER'
    )
  })

  it('surfaces PostgREST plain-object error messages in the failure toast', async () => {
    const user = userEvent.setup()
    await renderPanel()

    mocks.updateError = {
      message: 'permission denied for table guild_config'
    }

    await user.type(
      screen.getByLabelText(/Role ID \(blank = no fallback\)/i),
      '123456789012345678'
    )
    await user.click(screen.getByRole('button', { name: /Save default role/i }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Could not save default Herald role',
      'permission denied for table guild_config'
    )
  })
})
