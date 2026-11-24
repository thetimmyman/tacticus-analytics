import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GuildSettingsClient from '@/app/(dashboard)/guild-management/settings/GuildSettingsClient'
import type { GuildSettingsRecord } from '@/app/lib/services/guild-settings-service'

// Fixtures are synthetic; never use real guild codes or names.

vi.mock('@/app/(dashboard)/guild-management/settings/actions', () => ({
  saveGuildSettingsAction: vi.fn()
}))

vi.mock(
  '@/app/(dashboard)/guild-management/settings/IdentitySettingsPanel',
  () => ({
    IdentitySettingsPanel: () => <div>identity panel</div>
  })
)
vi.mock(
  '@/app/(dashboard)/guild-management/settings/IntegrationSettingsPanel',
  () => ({
    IntegrationSettingsPanel: () => <div>integrations panel</div>,
    SummaryDetail: {},
    ManualSyncSummary: {},
    IntegrationTone: {}
  })
)
vi.mock(
  '@/app/(dashboard)/guild-management/settings/ClusterSettingsPanel',
  () => ({
    ClusterSettingsPanel: () => <div>cluster panel</div>
  })
)
vi.mock(
  '@/app/(dashboard)/guild-management/settings/PrivacySettingsPanel',
  () => ({
    PrivacySettingsPanel: () => <div>privacy panel</div>
  })
)
vi.mock('@/app/(dashboard)/guild-management/settings/SettingsSection', () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('@/app/(dashboard)/guild-management/settings/DangerZonePanel', () => ({
  DangerZonePanel: () => <div>danger panel</div>
}))
vi.mock(
  '@/app/(dashboard)/guild-management/settings/PermissionsMatrixPanel',
  () => ({
    PermissionsMatrixPanel: () => <div>permissions panel</div>
  })
)
vi.mock(
  '@/app/(dashboard)/guild-management/settings/ClusterSettingsDialogs',
  () => ({
    ClusterSettingsDialogs: () => null
  })
)
vi.mock(
  '@/app/(dashboard)/guild-management/settings/useGuildClusterSettings',
  () => ({
    useGuildClusterSettings: () => ({
      clusterInfo: null,
      loadingClusterInfo: false,
      showClusterWizard: false,
      showJoinCluster: false,
      openClusterWizard: vi.fn(),
      openJoinCluster: vi.fn(),
      closeClusterWizard: vi.fn(),
      closeJoinCluster: vi.fn(),
      handleClusterCreated: vi.fn(),
      leaveCluster: vi.fn()
    })
  })
)
vi.mock(
  '@/app/(dashboard)/guild-management/settings/useGuildManualSync',
  () => ({
    useGuildManualSync: () => ({
      syncing: false,
      lastSyncTime: null,
      syncCooldown: false,
      handleManualSync: vi.fn()
    })
  })
)
vi.mock('@/app/(dashboard)/guild-management/settings/useGuildApiKey', () => ({
  useGuildApiKey: () => ({
    apiKey: '',
    setApiKey: vi.fn(),
    showApiKey: false,
    toggleApiKeyVisibility: vi.fn(),
    validatingApiKey: false,
    validationStatus: null,
    validationMessage: null,
    hasStoredApiKey: false,
    setHasStoredApiKey: vi.fn(),
    apiKeySummary: { status: 'Not set', helper: 'Add a key', tone: 'muted' },
    apiKeyLastUpdatedBy: null,
    apiKeyLastValidatedLabel: '—',
    apiKeyStoredState: null,
    handleValidateApiKey: vi.fn()
  })
}))
vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } })
}))

const config: GuildSettingsRecord = {
  id: 1,
  guild_code: 'TEST1',
  guild_tag: 'TEST1',
  display_name: 'Example Guild',
  enabled: true,
  GR_Ranking: 1,
  GW_Ranking: 2,
  gr_ranking: 1,
  gw_ranking: 2,
  token_offender_threshold: 10,
  token_abuser_threshold: 15,
  apply_token_offender_filtering: true,
  primary_assignment_tokens: 3,
  secondary_assignment_tokens: 2,
  discord_webhook_enabled: false,
  API_Owner: 'Example Leader',
  api_key_is_valid: null,
  api_key_last_validated: null,
  cluster_id: null,
  cluster_code: null,
  cluster_role: null,
  tagline: null,
  description: null,
  logo_url: null,
  timezone: 'UTC',
  theme_preset: 'default',
  last_successful_sync: null,
  social_links: null,
  explore_privacy_mode: ['public'],
  explore_obfuscation_percent: 10,
  created_at: '',
  updated_at: '',
  hasEncryptedApiKey: false
}

const renderSettings = () =>
  render(<GuildSettingsClient initialConfig={config} userRole="leader" />)

describe('GuildSettingsClient settings tablist', () => {
  it('wires tabs to panels with aria-controls and tabpanel roles', () => {
    renderSettings()

    const tablist = screen.getByRole('tablist', {
      name: 'Settings sections'
    })
    const integrations = within(tablist).getByRole('tab', {
      name: /integrations/i
    })
    expect(integrations).toHaveAttribute('aria-selected', 'true')
    expect(integrations).toHaveAttribute('tabindex', '0')
    expect(integrations).toHaveAttribute(
      'aria-controls',
      'settings-panel-integrations'
    )

    const identity = within(tablist).getByRole('tab', {
      name: /identity & branding/i
    })
    expect(identity).toHaveAttribute('tabindex', '-1')
    expect(identity).toHaveAttribute('aria-controls', 'settings-panel-identity')

    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBe('settings-panel-integrations')
    expect(panel).toHaveAttribute(
      'aria-labelledby',
      'settings-tab-integrations'
    )
    expect(panel.textContent).toContain('integrations panel')
  })

  it('moves selection and focus with the arrow keys, wrapping at the ends', () => {
    renderSettings()

    const tablist = screen.getByRole('tablist', {
      name: 'Settings sections'
    })
    const integrations = within(tablist).getByRole('tab', {
      name: /integrations/i
    })
    const identity = within(tablist).getByRole('tab', {
      name: /identity & branding/i
    })

    fireEvent.keyDown(integrations, { key: 'ArrowRight' })
    expect(identity).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(identity)
    expect(screen.getByRole('tabpanel').id).toBe('settings-panel-identity')

    fireEvent.keyDown(identity, { key: 'ArrowLeft' })
    expect(integrations).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(integrations)

    fireEvent.keyDown(integrations, { key: 'ArrowLeft' })
    const danger = within(tablist).getByRole('tab', { name: /danger zone/i })
    expect(danger).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel').textContent).toContain('danger panel')
  })

  it('selects a panel when its tab is clicked', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('tab', { name: /role matrix/i }))

    const tablist = screen.getByRole('tablist', {
      name: 'Settings sections'
    })
    const permissions = within(tablist).getByRole('tab', {
      name: /role matrix/i
    })
    expect(permissions).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBe('settings-panel-permissions')
    expect(panel.textContent).toContain('permissions panel')
  })
})
