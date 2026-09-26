import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ApiKeyManagementClient from '@/app/(dashboard)/api-keys/ApiKeyManagementClient'

const baseConfig = {
  id: 1,
  guild_code: 'GUILD_X',
  display_name: 'Test Guild',
  has_api_key: true,
  API_Owner: 'tester',
  api_key_is_valid: true,
  enabled: true,
  updated_at: new Date(Date.now() - 3600_000).toISOString(),
  api_key_last_validated: new Date(Date.now() - 3600_000).toISOString()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('WI-692 F13 ApiKeyManagementClient — Replace + Verify', () => {
  it('renders Replace + Verify button distinct from Save', () => {
    render(<ApiKeyManagementClient initialConfig={baseConfig} canRemove />)
    const replace = screen.getByTestId('replace-verify-button')
    expect(replace).toBeInTheDocument()
    expect(replace.textContent).toMatch(/Replace \+ Verify/)
    expect(screen.getByText(/Save API Key/)).toBeInTheDocument()
  })

  it('Replace + Verify button is disabled until a key is pasted', () => {
    render(<ApiKeyManagementClient initialConfig={baseConfig} canRemove />)
    const replace = screen.getByTestId(
      'replace-verify-button'
    ) as HTMLButtonElement
    expect(replace.disabled).toBe(true)

    const input = screen.getByLabelText(/Guild API Key/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'pasted-key-123' } })
    expect(replace.disabled).toBe(false)
  })

  it('successful replace updates "Last verified" timestamp anchor', async () => {
    const verifiedAt = new Date().toISOString()
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          verified_at: verifiedAt,
          guild_info: { guildId: 'uuid', guildName: 'Test Guild' },
          permissions: { canAccessGuild: true, canAccessRaidData: true }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    render(<ApiKeyManagementClient initialConfig={baseConfig} canRemove />)
    const input = screen.getByLabelText(/Guild API Key/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'pasted-key-123' } })
    fireEvent.click(screen.getByTestId('replace-verify-button'))

    await waitFor(() => {
      expect(
        screen.getByText(/API key updated successfully/i)
      ).toBeInTheDocument()
    })
    const lastVerified = screen.getByTestId('last-verified-display')
    expect(lastVerified.textContent ?? '').toMatch(/Last verified/i)
  })

  it('failed replace surfaces server error and does NOT clear key field', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'API key belongs to a different guild',
          details: 'This key is for "Other Guild", not GUILD_X.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    )

    render(<ApiKeyManagementClient initialConfig={baseConfig} canRemove />)
    const input = screen.getByLabelText(/Guild API Key/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong-guild-key' } })
    fireEvent.click(screen.getByTestId('replace-verify-button'))

    await waitFor(() => {
      expect(
        screen.getByText(/API key belongs to a different guild/i)
      ).toBeInTheDocument()
    })
    expect(input.value).toBe('wrong-guild-key')
  })

  it('renders "Last verified" with relative-time copy after mount', async () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
    render(
      <ApiKeyManagementClient
        initialConfig={{ ...baseConfig, api_key_last_validated: oneHourAgo }}
        canRemove
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('last-verified-display').textContent).toMatch(
        /Last verified \d+h ago/
      )
    })
  })

  it('renders "Never" when api_key_last_validated is null', async () => {
    render(
      <ApiKeyManagementClient
        initialConfig={{ ...baseConfig, api_key_last_validated: null }}
        canRemove
      />
    )
    expect(screen.getByTestId('last-verified-display').textContent).toBe(
      'Never'
    )
  })

  // Removal is officer+ server-side; members must not see a control that would 403.
  it('hides the Remove control when canRemove is false, keeping Save/Replace', () => {
    render(
      <ApiKeyManagementClient initialConfig={baseConfig} canRemove={false} />
    )
    expect(screen.queryByText('Remove API Key')).not.toBeInTheDocument()
    expect(screen.getByTestId('replace-verify-button')).toBeInTheDocument()
    expect(screen.getByText(/Save API Key/)).toBeInTheDocument()
  })

  it('shows the Remove control when canRemove is true', () => {
    render(<ApiKeyManagementClient initialConfig={baseConfig} canRemove />)
    expect(screen.getByText('Remove API Key')).toBeInTheDocument()
  })
})
