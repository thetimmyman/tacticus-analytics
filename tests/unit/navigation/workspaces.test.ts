import { describe, expect, it } from 'vitest'
import {
  getVisibleWorkspaceSections,
  resolveActiveWorkspace,
  workspaces
} from '@/app/components/navigation/workspaces'

describe('workspace visibility', () => {
  const raid = workspaces.find((workspace) => workspace.id === 'raid')
  const guildOps = workspaces.find((workspace) => workspace.id === 'guild-ops')
  const tools = workspaces.find((workspace) => workspace.id === 'tools')

  it('surfaces Playbooks as the consolidated Herald entry point', () => {
    expect(raid).toBeDefined()
    expect(guildOps).toBeDefined()

    for (const effectiveRole of ['member', 'officer', 'leader'] as const) {
      for (const isAlphaDeployment of [false, true]) {
        const raidSections = getVisibleWorkspaceSections(raid!, {
          effectiveRole,
          isAlphaDeployment
        })
        const guildOpsSections = getVisibleWorkspaceSections(guildOps!, {
          effectiveRole,
          isAlphaDeployment
        })

        expect(raidSections.map((section) => section.href)).toContain(
          '/boss-playbooks'
        )
        expect(guildOpsSections.map((section) => section.href)).not.toContain(
          '/guild-ops/herald'
        )
      }
    }

    expect(
      raid?.sections.find((section) => section.href === '/boss-playbooks')
    ).toMatchObject({
      label: 'Playbooks',
      releaseStage: 'public'
    })
  })

  it('resolves /boss-assignments to the Guild Ops workspace (relocation)', () => {
    expect(resolveActiveWorkspace('/boss-assignments').id).toBe('guild-ops')
    expect(resolveActiveWorkspace('/boss-assignments/current').id).toBe(
      'guild-ops'
    )
    const guildOps = workspaces.find(
      (workspace) => workspace.id === 'guild-ops'
    )
    expect(
      guildOps?.sections.find((section) => section.href === '/boss-assignments')
    ).toMatchObject({
      label: 'Boss Assignments',
      roles: ['member', 'officer', 'leader']
    })
    const adminWs = workspaces.find((workspace) => workspace.id === 'admin')
    expect(adminWs?.match).not.toContain('/boss-assignments')
    expect(
      adminWs?.sections.find((section) => section.href === '/boss-assignments')
    ).toBeUndefined()
  })

  it('keeps Tools limited to external community resources', () => {
    expect(tools).toBeDefined()
    expect(tools?.match).toEqual([])
    expect(tools?.sections.length).toBeGreaterThan(0)
    expect(tools?.sections.every((section) => section.external)).toBe(true)
    expect(
      tools?.sections.some((section) => section.href.startsWith('/'))
    ).toBe(false)
  })

  it('hides the Admin workspace from non-admins', () => {
    const admin = workspaces.find((workspace) => workspace.id === 'admin')
    expect(admin).toBeDefined()
    const sectionsForOfficer = getVisibleWorkspaceSections(admin!, {
      effectiveRole: 'officer',
      isAppAdmin: false
    })
    expect(sectionsForOfficer).toHaveLength(0)
    const sectionsForAdmin = getVisibleWorkspaceSections(admin!, {
      effectiveRole: 'officer',
      isAppAdmin: true
    })
    expect(sectionsForAdmin.map((s) => s.href)).toEqual([
      '/admin/feature-releases'
    ])
    expect(
      sectionsForAdmin.find(
        (section) => section.href === '/guild-management/exports'
      )
    ).toBeUndefined()
  })

  // Inactive sessions get a recovery-safe allowlist, never generic member links.
  it('exposes only recovery-safe navigation for inactive sessions', () => {
    const visible = Object.fromEntries(
      workspaces.map((workspace) => [
        workspace.id,
        getVisibleWorkspaceSections(workspace, {
          effectiveRole: 'member',
          hasProfile: false,
          hideAnalytics: true,
          isAlphaDeployment: false
        }).map((section) => section.href)
      ])
    )

    expect(visible).toEqual({
      command: ['/home', '/explore'],
      raid: [],
      'guild-ops': [],
      war: [],
      tools: [],
      community: [
        '/creators',
        '/support-creator',
        '/acknowledgements',
        'https://discord.gg/vd9Htx6Xs4'
      ],
      settings: [],
      admin: []
    })
  })
})
