import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { TokenAlertSettings } from '@/app/(dashboard)/profile/TokenAlertSettings'

const DEFAULT_PREFS = {
  alert_on_full: false,
  alert_on_full_repeat_hours: null,
  alert_before_full: false,
  alert_before_full_minutes: 120,
  alert_on_token_gained: false,
  alert_on_bomb_ready: false,
  alert_before_bomb_ready: false,
  alert_before_bomb_ready_minutes: 120,
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_timezone: null,
  alert_before_quiet_hours: false,
  alert_before_quiet_hours_minutes: 30,
  alert_before_burn: false,
  alert_before_burn_minutes: 30
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  }) as Promise<Response>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TokenAlertSettings', () => {
  it('renders nothing when the settings API is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => jsonResponse(200, { available: false }))
    )

    const { container } = render(<TokenAlertSettings />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('shows disabled toggles and a Link Discord CTA when unlinked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        jsonResponse(200, {
          available: true,
          linked: false,
          dmBlocked: false,
          prefs: DEFAULT_PREFS
        })
      )
    )

    render(<TokenAlertSettings />)

    expect(
      await screen.findByText(
        'Link your Discord account to enable token alert DMs.'
      )
    ).toBeInTheDocument()

    // Bomb sub-toggles stay collapsed until their group is on; pre-quiet needs enabled quiet hours.
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(7)
    switches.forEach((el) => expect(el).toBeDisabled())

    expect(screen.getByRole('link', { name: 'Link Discord' })).toHaveAttribute(
      'href',
      '#connected-accounts'
    )
  })

  // Discord only delivers bot DMs to users sharing a server with the bot.

  it('replaces the toggles with an ask-your-leader CTA for members when the bot is not installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        jsonResponse(200, {
          available: true,
          linked: true,
          dmBlocked: false,
          botInstalled: false,
          canSetupBot: false,
          prefs: DEFAULT_PREFS
        })
      )
    )

    render(<TokenAlertSettings />)

    expect(
      await screen.findByText(
        /ask your guild leader to set up the tacticus analytics discord bot/i
      )
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('offers officers/leaders a link to the bot setup flow when the bot is not installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        jsonResponse(200, {
          available: true,
          linked: false,
          dmBlocked: false,
          botInstalled: false,
          canSetupBot: true,
          prefs: DEFAULT_PREFS
        })
      )
    )

    render(<TokenAlertSettings />)

    const setupLink = await screen.findByRole('link', {
      name: /set up the tacticus analytics discord bot/i
    })
    expect(setupLink).toHaveAttribute('href', '/guild-management/settings')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('keeps the normal panel when the response omits the bot-install fields', async () => {
    // Older images never send botInstalled; only an explicit false may gate.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        jsonResponse(200, {
          available: true,
          linked: true,
          dmBlocked: false,
          prefs: DEFAULT_PREFS
        })
      )
    )

    render(<TokenAlertSettings />)

    expect(
      await screen.findByRole('switch', { name: 'Alert when tokens are full' })
    ).toBeInTheDocument()
  })

  it('shows the DM-blocked warning banner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        jsonResponse(200, {
          available: true,
          linked: true,
          dmBlocked: true,
          prefs: DEFAULT_PREFS
        })
      )
    )

    render(<TokenAlertSettings />)

    expect(await screen.findByText(/We couldn.t DM you/i)).toBeInTheDocument()
  })

  it('enables toggles when linked and saves via PUT', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method === undefined) {
          return jsonResponse(200, {
            available: true,
            linked: true,
            dmBlocked: false,
            prefs: DEFAULT_PREFS
          })
        }
        if (init.method === 'PUT') {
          return jsonResponse(200, {
            available: true,
            linked: true,
            dmBlocked: false,
            prefs: { ...DEFAULT_PREFS, alert_on_full: true }
          })
        }
        return jsonResponse(200, { available: false })
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<TokenAlertSettings />)

    const fullSwitch = await screen.findByRole('switch', {
      name: 'Alert when tokens are full'
    })
    expect(fullSwitch).not.toBeDisabled()

    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()

    fireEvent.click(fullSwitch)
    expect(saveButton).not.toBeDisabled()

    fireEvent.click(saveButton)

    expect(
      await screen.findByText('Token alert settings saved.')
    ).toBeInTheDocument()

    const putCall = fetchMock.mock.calls.find(
      ([, init]: [string, RequestInit?]) => init?.method === 'PUT'
    )
    expect(putCall).toBeDefined()
    expect(JSON.parse(putCall![1].body as string)).toEqual({
      ...DEFAULT_PREFS,
      alert_on_full: true
    })
  })

  it('configures repeats under the full alert and clears them when full is disabled', async () => {
    const fetchMock = stubLinked({ alert_on_full: true })
    render(<TokenAlertSettings />)

    const repeatSwitch = await screen.findByRole('switch', {
      name: 'Repeat reminders while still full'
    })
    expect(repeatSwitch).not.toBeDisabled()
    expect(repeatSwitch).not.toBeChecked()
    fireEvent.click(repeatSwitch)

    const repeatSelect = screen.getByLabelText('Repeat reminder cadence')
    expect(repeatSelect).toHaveValue('11')
    fireEvent.change(repeatSelect, { target: { value: '12' } })

    const fullSwitch = screen.getByRole('switch', {
      name: 'Alert when tokens are full'
    })
    fireEvent.click(fullSwitch)

    expect(repeatSwitch).toBeDisabled()
    expect(repeatSwitch).not.toBeChecked()
    expect(
      screen.queryByLabelText('Repeat reminder cadence')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([, init]: [string, RequestInit?]) => init?.method === 'PUT'
      )
      expect(putCall).toBeDefined()
      expect(JSON.parse(putCall![1].body as string)).toMatchObject({
        alert_on_full: false,
        alert_on_full_repeat_hours: null
      })
    })
  })

  it('shows the Link Discord CTA when the PUT is rejected as unlinked (409)', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method === undefined) {
          return jsonResponse(200, {
            available: true,
            linked: true,
            dmBlocked: false,
            prefs: DEFAULT_PREFS
          })
        }
        if (init.method === 'PUT') {
          return jsonResponse(409, {
            error: { message: 'DISCORD_NOT_LINKED' }
          })
        }
        return jsonResponse(200, { available: false })
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<TokenAlertSettings />)

    const fullSwitch = await screen.findByRole('switch', {
      name: 'Alert when tokens are full'
    })
    fireEvent.click(fullSwitch)

    const saveButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(saveButton)

    expect(
      await screen.findByText(
        'Link your Discord account to enable token alert DMs.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: 'Link Discord' }).length
    ).toBeGreaterThan(0)
  })

  function stubLinked(prefs: Record<string, unknown> = {}) {
    const fetchMock = vi.fn().mockImplementation(() =>
      jsonResponse(200, {
        available: true,
        linked: true,
        dmBlocked: false,
        prefs: { ...DEFAULT_PREFS, ...prefs }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('keeps the bomb sub-settings collapsed until the group is switched on', async () => {
    stubLinked()
    render(<TokenAlertSettings />)

    const groupSwitch = await screen.findByRole('switch', {
      name: /also alert me about bombs/i
    })
    expect(screen.queryByText(/when a bomb is ready/i)).not.toBeInTheDocument()

    fireEvent.click(groupSwitch)

    expect(await screen.findByText(/when a bomb is ready/i)).toBeInTheDocument()
  })

  it('reveals the bomb group already open when a bomb toggle is saved on', async () => {
    stubLinked({ alert_before_bomb_ready: true })
    render(<TokenAlertSettings />)

    expect(await screen.findByText(/when a bomb is ready/i)).toBeInTheDocument()
  })

  it('clears BOTH bomb toggles when the group is switched off', async () => {
    const fetchMock = stubLinked({
      alert_on_bomb_ready: true,
      alert_before_bomb_ready: true
    })
    render(<TokenAlertSettings />)

    const groupSwitch = await screen.findByRole('switch', {
      name: /also alert me about bombs/i
    })
    fireEvent.click(groupSwitch)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')
      expect(put).toBeDefined()
      const sent = JSON.parse(put![1].body as string)
      // A hidden sub-toggle left true would keep sending DMs turned off at group level.
      expect(sent.alert_on_bomb_ready).toBe(false)
      expect(sent.alert_before_bomb_ready).toBe(false)
    })
  })

  it('sends a complete quiet-hours triple when quiet hours are enabled', async () => {
    const fetchMock = stubLinked()
    render(<TokenAlertSettings />)

    const quietSwitch = await screen.findByRole('switch', {
      name: /quiet hours/i
    })
    fireEvent.click(quietSwitch)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')
      expect(put).toBeDefined()
      const sent = JSON.parse(put![1].body as string)
      // A DB CHECK makes a partial triple unrepresentable.
      expect(sent.quiet_hours_start).toEqual(expect.any(Number))
      expect(sent.quiet_hours_end).toEqual(expect.any(Number))
      expect(typeof sent.quiet_hours_timezone).toBe('string')
    })
  })

  it('blocks Save when the quiet window starts and ends at the same hour', async () => {
    stubLinked({
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      quiet_hours_timezone: 'UTC'
    })
    render(<TokenAlertSettings />)

    const startSelect = await screen.findByLabelText('From')
    fireEvent.change(startSelect, { target: { value: '7' } })

    expect(
      await screen.findByText(/pick two different times/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('clears the whole quiet-hours triple when quiet hours are switched off', async () => {
    const fetchMock = stubLinked({
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      quiet_hours_timezone: 'UTC'
    })
    render(<TokenAlertSettings />)

    const quietSwitch = await screen.findByRole('switch', {
      name: /quiet hours/i
    })
    fireEvent.click(quietSwitch)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')
      expect(put).toBeDefined()
      const sent = JSON.parse(put![1].body as string)
      expect(sent.quiet_hours_start).toBeNull()
      expect(sent.quiet_hours_end).toBeNull()
      expect(sent.quiet_hours_timezone).toBeNull()
      // The DB CHECK forbids pre-quiet without its parent, so leaving it true would 400.
      expect(sent.alert_before_quiet_hours).toBe(false)
    })
  })

  it('keeps the pre-quiet control hidden until quiet hours are enabled', async () => {
    // The lead is measured from the start hour, so the API and a DB CHECK reject it without a window.
    stubLinked()
    render(<TokenAlertSettings />)

    await screen.findByText(/alert when tokens are full/i)
    expect(
      screen.queryByRole('switch', { name: /before the quiet window starts/i })
    ).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: /quiet hours/i }))

    expect(
      screen.getByRole('switch', { name: /before the quiet window starts/i })
    ).toBeInTheDocument()
  })

  it('sends the pre-burn toggle and its lead time', async () => {
    const fetchMock = stubLinked()
    render(<TokenAlertSettings />)

    const burnSwitch = await screen.findByRole('switch', {
      name: /before burning a token/i
    })
    fireEvent.click(burnSwitch)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')
      expect(put).toBeDefined()
      const sent = JSON.parse(put![1].body as string)
      expect(sent.alert_before_burn).toBe(true)
      expect(sent.alert_before_burn_minutes).toBe(30)
    })
  })

  it('disables the burn lead select until the burn toggle is on', async () => {
    stubLinked()
    render(<TokenAlertSettings />)

    // The switch and the select share a label phrase.
    const select = (await screen.findByRole('combobox', {
      name: /before burning a token/i
    })) as HTMLSelectElement
    expect(select).toBeDisabled()

    fireEvent.click(
      screen.getByRole('switch', { name: /before burning a token/i })
    )
    expect(select).not.toBeDisabled()
  })
})
