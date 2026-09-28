'use client'

import { Input } from '@tacticus/ui-kit'
import type { PlayerRole } from '@tacticus/app-core/types'
import { getRoleDisplayName } from '@/app/lib/auth/permissions'
import type { RoleFilter } from './types'

interface MemberFiltersProps {
  searchTerm: string
  onSearchChange: (value: string) => void
  roleFilter: RoleFilter
  onRoleFilterChange: (value: RoleFilter) => void
  roleOptions: PlayerRole[]
  roleBreakdown: Map<PlayerRole, number>
  rosterCount: number
  claimedProfiles: number
  veteranCount: number
}

export function MemberFilters({
  searchTerm,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  roleOptions,
  roleBreakdown,
  rosterCount,
  claimedProfiles,
  veteranCount
}: MemberFiltersProps) {
  return (
    <div className="card-wh40k overflow-hidden">
      <div className="px-6 py-4 border-b border-(--card-border)">
        <div>
          <h2 className="text-lg font-semibold text-primary-wh40k">
            Member Management
          </h2>
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-secondary-wh40k">
            <span>{rosterCount} total members</span>
            <span className="text-accent-wh40k">&middot;</span>
            <span>{claimedProfiles} claimed profiles</span>
            <span className="text-accent-wh40k">&middot;</span>
            <span>{veteranCount} five-season veterans</span>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:max-w-md">
            <label className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide">
              Search Members
            </label>
            <Input
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by display name, Discord handle, role, or user ID..."
            />
          </div>
          <div className="flex flex-col gap-2 md:w-56">
            <label className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide">
              Role Filter
            </label>
            <select
              value={roleFilter}
              onChange={(event) =>
                onRoleFilterChange(event.target.value as RoleFilter)
              }
              className="w-full rounded-sm border border-(--card-border) bg-(--bg-secondary) px-3 py-2 text-sm text-primary-wh40k"
            >
              <option value="all">All Roles</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {getRoleDisplayName(role)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-secondary-wh40k">
          {roleOptions.map((role) => (
            <span
              key={role}
              className="rounded-sm bg-(--bg-secondary) px-2 py-1"
            >
              {getRoleDisplayName(role)} · {roleBreakdown.get(role) ?? 0}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
