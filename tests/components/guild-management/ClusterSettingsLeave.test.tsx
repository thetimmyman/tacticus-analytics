import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  render,
  renderHook,
  screen
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserRole } from '@tacticus/app-core/types'
import type {
  ClusterDetails,
  GuildSettingsRecord
} from '@/app/lib/services/guild-settings-service'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('@/app/hooks/useToast', () => ({ useToast: () => ({ toast }) }))

import { ClusterSettingsPanel } from '@/app/(dashboard)/guild-management/settings/ClusterSettingsPanel'
import {
  useGuildClusterSettings,
  type LeaveClusterControls
} from '@/app/(dashboard)/guild-management/settings/useGuildClusterSettings'

const clusteredGuild = {
  guild_code: 'EXAMPLE',
  display_name: 'Example Guild',
  cluster_code: 'CLU',
  cluster_id: 'cluster-1'
} as GuildSettingsRecord

const clusterInfo: ClusterDetails = {
  cluster_code: 'CLU',
  display_name: 'Example Cluster',
  description: null
}

function controls(overrides: Partial<LeaveClusterControls> = {}) {
  return {
    open: false,
    busy: false,
    onOpen: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides
  }
}

function renderPanel(
  userRole: UserRole,
  leaveCluster: LeaveClusterControls,
  guildConfig: GuildSettingsRecord = clusteredGuild
) {
  return render(
    <ClusterSettingsPanel
      userRole={userRole}
      guildConfig={guildConfig}
      loadingClusterInfo={false}
      clusterInfo={guildConfig.cluster_code ? clusterInfo : null}
      onCreateCluster={() => {}}
      onJoinCluster={() => {}}
      saving={false}
      leaveCluster={leaveCluster}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Leave cluster in guild settings', () => {
  it('offers a guild leader Leave cluster and opens the confirmation', async () => {
    const leave = controls()
    renderPanel('leader', leave)

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /leave cluster/i }))

    expect(leave.onOpen).toHaveBeenCalledTimes(1)
  })

  it('does not offer an officer Leave cluster', () => {
    renderPanel('officer', controls())
    expect(screen.queryByRole('button', { name: /leave cluster/i })).toBeNull()
  })

  it('does not offer Leave cluster to a guild with no cluster', () => {
    renderPanel('leader', controls(), {
      ...clusteredGuild,
      cluster_code: null,
      cluster_id: null
    } as GuildSettingsRecord)
    expect(screen.queryByRole('button', { name: /leave cluster/i })).toBeNull()
    expect(
      screen.getByRole('button', { name: /join with invite code/i })
    ).toBeTruthy()
  })

  it('says what leaving changes and confirms only on the confirm button', async () => {
    const leave = controls({ open: true })
    renderPanel('leader', leave)

    const dialog = screen.getByRole('dialog', {
      name: 'Leave Example Cluster?'
    })
    expect(dialog.textContent).toContain('loses access')
    expect(dialog.textContent).toContain('syncing stay as they are')
    expect(dialog.textContent).toContain('Join with invite code')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(leave.onCancel).toHaveBeenCalledTimes(1)
    expect(leave.onConfirm).not.toHaveBeenCalled()

    const confirmButtons = screen.getAllByRole('button', {
      name: 'Leave cluster'
    })
    await user.click(confirmButtons[confirmButtons.length - 1])
    expect(leave.onConfirm).toHaveBeenCalledTimes(1)
  })

  it("asks the server to leave the cluster the page shows, and reports the server's reason", async () => {
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/clusters/leave'
          ? json(
              {
                error: "You created this cluster, so your guild can't leave it."
              },
              403
            )
          : json({ success: true, data: clusterInfo }, 200)
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useGuildClusterSettings(clusteredGuild))

    act(() => result.current.leaveCluster.onOpen())
    expect(result.current.leaveCluster.open).toBe(true)

    await act(async () => {
      result.current.leaveCluster.onConfirm()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/clusters/leave',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clusterCode: 'CLU' })
      })
    )
    expect(toast.error).toHaveBeenCalledWith(
      'Could not leave the cluster',
      "You created this cluster, so your guild can't leave it."
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.leaveCluster.open).toBe(true)
    expect(result.current.leaveCluster.busy).toBe(false)
  })
})
