'use client'

import { useId } from 'react'
import { Input } from '@tacticus/ui-kit'
import type { PlayerRole } from '@tacticus/app-core/types'
import { FilterBar } from '@/app/components/ui/FilterBar'
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
  const searchId = useId()
  const roleId = useId()
  const activeCount =
    (searchTerm.trim() ? 1 : 0) + (roleFilter !== 'all' ? 1 : 0)

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

      <div className="px-6 py-4">
        <FilterBar
          search={
            <div className="flex flex-1 flex-col gap-2 md:max-w-md">
              <label
                htmlFor={searchId}
                className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide"
              >
                Search Members
              </label>
              <Input
                id={searchId}
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search by display name, Discord handle, role, or user ID..."
              />
            </div>
          }
          primaryFilters={
            <div className="flex w-full flex-col gap-2 md:w-56">
              <label
                htmlFor={roleId}
                className="text-xs font-medium text-secondary-wh40k uppercase tracking-wide"
              >
                Role Filter
              </label>
              <select
                id={roleId}
                value={roleFilter}
                onChange={(event) =>
                  onRoleFilterChange(event.target.value as RoleFilter)
                }
                className="w-full min-h-[44px] rounded-sm border border-(--card-border) bg-(--bg-secondary) px-3 py-2 text-sm text-primary-wh40k"
              >
                <option value="all">All Roles</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {getRoleDisplayName(role)}
                  </option>
                ))}
              </select>
            </div>
          }
          activeCount={activeCount}
          onReset={() => {
            onSearchChange('')
            onRoleFilterChange('all')
          }}
        >
          <div className="flex flex-wrap gap-3 pt-2 text-xs text-secondary-wh40k">
            {roleOptions.map((role) => (
              <span
                key={role}
                className="rounded-sm bg-(--bg-secondary) px-2 py-1"
              >
                {getRoleDisplayName(role)} · {roleBreakdown.get(role) ?? 0}
              </span>
            ))}
          </div>
        </FilterBar>
      </div>
    </div>
  )
}
