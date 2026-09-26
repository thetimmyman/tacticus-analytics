'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Trash2, Search } from 'lucide-react'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import {
  ROLE_TABS,
  type AdminUser,
  type RoleType,
  type UserGrant,
  type ViewTab
} from './user-manager-shared'

interface UserManagerRoleTabProps {
  activeTab: Exclude<ViewTab, 'search'>
  filterQuery: string
  setFilterQuery: Dispatch<SetStateAction<string>>
  admins: AdminUser[]
  alphaTesters: UserGrant[]
  betaTesters: UserGrant[]
  filterList: <T extends { email: string; display_name?: string | null }>(
    users: T[]
  ) => T[]
  removeFromRole: (email: string, roleType: RoleType) => Promise<void>
}

export function UserManagerRoleTab({
  activeTab,
  filterQuery,
  setFilterQuery,
  admins,
  alphaTesters,
  betaTesters,
  filterList,
  removeFromRole
}: UserManagerRoleTabProps) {
  return (
    <Card className={ROLE_TABS.find((t) => t.key === activeTab)?.border}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className={ROLE_TABS.find((t) => t.key === activeTab)?.color}>
            {ROLE_TABS.find((t) => t.key === activeTab)?.icon}
          </span>
          {ROLE_TABS.find((t) => t.key === activeTab)?.label}
          {activeTab !== 'admins' && (
            <ReleaseStageBadge
              stage={activeTab === 'alpha' ? 'alpha' : 'beta'}
              size="sm"
            />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter by email..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-tertiary)] text-sm"
          />
        </div>

        <div className="space-y-2">
          {activeTab === 'admins' ? (
            filterList(admins).length === 0 ? (
              <p className="text-[var(--text-secondary)] text-sm py-4 text-center">
                No admins found
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filterList(admins).map((admin) => (
                  <div
                    key={admin.user_id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-[var(--text-primary)] text-sm truncate block">
                        {admin.display_name || admin.email}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] flex-wrap">
                        {admin.cluster_code && (
                          <span>[{admin.cluster_code}]</span>
                        )}
                        {admin.guild_code ? (
                          <span>
                            {formatGuildDisplayLabel(null, admin.guild_code)}
                          </span>
                        ) : null}
                        {admin.role && (
                          <span className="capitalize">• {admin.role}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromRole(admin.email, 'admin')}
                      className="text-red-400 hover:text-red-300 transition-colors shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            (() => {
              const listMap: Record<string, UserGrant[]> = {
                alpha: alphaTesters,
                beta: betaTesters
              }
              const roleTypeMap: Record<string, RoleType> = {
                alpha: 'alpha_tester',
                beta: 'beta_tester'
              }
              const list = filterList(listMap[activeTab] || [])
              const roleType = roleTypeMap[activeTab]
              const tab = ROLE_TABS.find((t) => t.key === activeTab)!

              return list.length === 0 ? (
                <p className="text-[var(--text-secondary)] text-sm py-4 text-center">
                  No {tab.label.toLowerCase()} found
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((user) => (
                    <div
                      key={user.user_id}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${tab.bg} border ${tab.border}`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-[var(--text-primary)] text-sm truncate block">
                          {user.display_name || user.email}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] flex-wrap">
                          {user.cluster_code && (
                            <span>[{user.cluster_code}]</span>
                          )}
                          {user.guild_code ? (
                            <span>
                              {formatGuildDisplayLabel(null, user.guild_code)}
                            </span>
                          ) : null}
                          {user.role && (
                            <span className="capitalize">• {user.role}</span>
                          )}
                        </div>
                        {user.notes && (
                          <span className="text-xs text-[var(--text-tertiary)] truncate block">
                            {user.notes}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          removeFromRole(user.email, roleType as RoleType)
                        }
                        className="text-red-400 hover:text-red-300 transition-colors shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })()
          )}
        </div>
      </CardContent>
    </Card>
  )
}
