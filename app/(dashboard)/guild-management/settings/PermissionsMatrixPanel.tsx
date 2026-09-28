import { Fragment } from 'react'
import { Info, Shield } from 'lucide-react'
import { StatusLabel } from '@tacticus/ui-kit'
import { SettingsSection } from './SettingsSection'

const PERMISSIONS_MATRIX = [
  {
    category: 'Dashboard & Analytics',
    items: [
      { page: 'Dashboard View', member: true, officer: true, leader: true },
      { page: 'Player Statistics', member: true, officer: true, leader: true },
      { page: 'VOTLW Awards', member: true, officer: true, leader: true },
      {
        page: 'Boss Performance Pages',
        member: true,
        officer: true,
        leader: true
      }
    ]
  },
  {
    category: 'Management Tools',
    items: [
      {
        page: 'Player Performance Analysis',
        member: false,
        officer: true,
        leader: true
      },
      {
        page: 'Token Usage Tracking',
        member: false,
        officer: true,
        leader: true
      },
      {
        page: 'Member Management',
        member: false,
        officer: true,
        leader: true
      },
      {
        page: 'Boss Assignments',
        member: false,
        officer: true,
        leader: true
      }
    ]
  },
  {
    category: 'Administrative',
    items: [
      {
        page: 'Guild Settings',
        member: false,
        officer: true,
        leader: true
      },
      {
        page: 'API Key Management',
        member: false,
        officer: false,
        leader: true
      },
      {
        page: 'Discord Integrations',
        member: false,
        officer: false,
        leader: true
      },
      {
        page: 'Promote to Leader',
        member: false,
        officer: false,
        leader: true
      }
    ]
  },
  {
    category: 'Cluster Features',
    items: [
      { page: 'Cluster Overview', member: true, officer: true, leader: true },
      {
        page: 'Cross-Guild Analytics',
        member: true,
        officer: true,
        leader: true
      },
      {
        page: 'Admin Monitoring',
        member: false,
        officer: false,
        leader: true
      }
    ]
  }
] as const

function PermissionStatus({ allowed }: { allowed: boolean }) {
  return (
    <StatusLabel type={allowed ? 'success' : 'inactive'}>
      {allowed ? 'Access' : 'No'}
    </StatusLabel>
  )
}

export function PermissionsMatrixPanel() {
  return (
    <SettingsSection
      title="Role permissions matrix"
      description="Reference which roles have command authority across major surfaces."
      icon={Shield}
    >
      <div className="hidden md:block overflow-hidden rounded-3xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] shadow-[0_20px_40px_rgba(4,8,20,0.45)]">
        <table className="w-full min-w-[640px] divide-y divide-[color-mix(in_srgb,var(--card-border)_60%,transparent)] text-sm">
          <thead className="bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] uppercase tracking-wide text-xs text-(--text-tertiary)">
            <tr>
              <th className="px-6 py-4 text-left">Feature</th>
              <th className="px-6 py-4 text-center">Member</th>
              <th className="px-6 py-4 text-center">Officer</th>
              <th className="px-6 py-4 text-center">Leader</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color-mix(in_srgb,var(--card-border)_50%,transparent)]">
            {PERMISSIONS_MATRIX.map((section) => (
              <Fragment key={section.category}>
                <tr className="bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)]">
                  <td
                    colSpan={4}
                    className="px-6 py-2 text-xs font-semibold text-secondary-wh40k uppercase"
                  >
                    {section.category}
                  </td>
                </tr>
                {section.items.map((item) => (
                  <tr
                    key={item.page}
                    className="hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors"
                  >
                    <td className="px-6 py-3 text-primary-wh40k">
                      {item.page}
                    </td>
                    <td className="px-6 py-3 text-center">
                      <PermissionStatus allowed={item.member} />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <PermissionStatus allowed={item.officer} />
                    </td>
                    <td className="px-6 py-3 text-center">
                      <PermissionStatus allowed={item.leader} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-6">
        {PERMISSIONS_MATRIX.map((section) => (
          <div key={section.category} className="space-y-3">
            <h4 className="text-sm font-semibold text-secondary-wh40k uppercase tracking-wide px-2">
              {section.category}
            </h4>
            <div className="space-y-3">
              {section.items.map((item) => (
                <div
                  key={item.page}
                  className="rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-4 shadow-[0_10px_20px_rgba(4,8,20,0.25)]"
                >
                  <h5 className="font-medium text-primary-wh40k mb-3">
                    {item.page}
                  </h5>
                  <div className="grid grid-cols-3 gap-3">
                    {(
                      [
                        ['Member', item.member],
                        ['Officer', item.officer],
                        ['Leader', item.leader]
                      ] as const
                    ).map(([role, allowed]) => (
                      <div key={role} className="text-center">
                        <div className="text-xs text-(--text-tertiary) uppercase tracking-wide mb-2">
                          {role}
                        </div>
                        <PermissionStatus allowed={allowed} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-5 text-sm text-secondary-wh40k">
        <h3 className="flex items-center gap-2 text-primary-wh40k font-semibold">
          <Info className="h-4 w-4 text-(--accent)" />
          Additional notes
        </h3>
        <ul className="mt-3 list-disc list-inside space-y-2">
          <li>
            Leaders can delegate many tasks to officers, but API keys and
            cluster management remain leader-exclusive.
          </li>
          <li>
            Members retain read-only access to dashboards, awards, and
            leaderboards.
          </li>
          <li>
            Cluster tools respect the highest role available across the alliance
            hierarchy.
          </li>
        </ul>
      </div>
    </SettingsSection>
  )
}
