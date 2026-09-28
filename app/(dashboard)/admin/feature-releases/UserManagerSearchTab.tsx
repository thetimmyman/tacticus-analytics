'use client'

import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import {
  Users,
  Trash,
  Search,
  Loader2,
  UserPlus,
  Filter,
  ChevronDown,
  BuildingComplex,
  CheckSquare,
  Square,
  UserCheck,
  Mail,
  Globe,
  Ban
} from 'lucide-react'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import {
  GAME_ROLES,
  type Guild,
  type RoleType,
  type UserResult
} from './user-manager-shared'

interface UserManagerSearchTabProps {
  searchQuery: string
  setSearchQuery: Dispatch<SetStateAction<string>>
  searching: boolean
  showFilters: boolean
  toggleFilters: () => void
  filterGuild: string
  setFilterGuild: Dispatch<SetStateAction<string>>
  filterRole: string
  setFilterRole: Dispatch<SetStateAction<string>>
  filterHasAccount: 'all' | 'yes' | 'no'
  setFilterHasAccount: Dispatch<SetStateAction<'all' | 'yes' | 'no'>>
  showGuildDropdown: boolean
  setShowGuildDropdown: Dispatch<SetStateAction<boolean>>
  guildDropdownRef: RefObject<HTMLDivElement | null>
  guilds: Guild[]
  selectGuild: (guildCode: string) => void
  selectedGuild: Guild | undefined
  searchResults: UserResult[]
  searchTotal: number
  selectedUsers: Set<string>
  toggleUserSelection: (userId: string) => void
  toggleAllVisible: () => void
  allVisibleSelected: boolean
  getRoleBadges: (user: UserResult) => { label: string; color: string }[]
  bulkAction: 'add' | 'remove'
  setBulkAction: Dispatch<SetStateAction<'add' | 'remove'>>
  bulkRoleType: RoleType
  setBulkRoleType: Dispatch<SetStateAction<RoleType>>
  bulkNotes: string
  setBulkNotes: Dispatch<SetStateAction<string>>
  processing: boolean
  executeBulkAction: () => Promise<void>
  onBanUser: (user: UserResult) => void
}

export function UserManagerSearchTab({
  searchQuery,
  setSearchQuery,
  searching,
  showFilters,
  toggleFilters,
  filterGuild,
  setFilterGuild,
  filterRole,
  setFilterRole,
  filterHasAccount,
  setFilterHasAccount,
  showGuildDropdown,
  setShowGuildDropdown,
  guildDropdownRef,
  guilds,
  selectGuild,
  selectedGuild,
  searchResults,
  searchTotal,
  selectedUsers,
  toggleUserSelection,
  toggleAllVisible,
  allVisibleSelected,
  getRoleBadges,
  bulkAction,
  setBulkAction,
  bulkRoleType,
  setBulkRoleType,
  bulkNotes,
  setBulkNotes,
  processing,
  executeBulkAction,
  onBanUser
}: UserManagerSearchTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5" />
            Search Users
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-(--text-tertiary)" />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-(--text-tertiary) animate-spin" />
              )}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search username, display name, player ID, email, discord..."
                className="w-full pl-10 pr-10 py-2.5 bg-(--input-bg) border border-(--card-border) rounded-lg text-primary-wh40k placeholder-(--text-tertiary) text-sm"
              />
            </div>

            <Button
              variant="outline"
              onClick={toggleFilters}
              className={`gap-2 ${showFilters ? 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border-[color-mix(in_srgb,var(--primary)_30%,transparent)]' : ''}`}
            >
              <Filter className="h-4 w-4" />
              Filters
              {(filterGuild || filterRole || filterHasAccount !== 'all') && (
                <span className="w-2 h-2 rounded-full bg-primary-wh40k" />
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="p-4 rounded-lg bg-(--bg-secondary) border border-(--card-border) space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div ref={guildDropdownRef} className="relative">
                  <label className="text-xs font-medium text-secondary-wh40k mb-1 block">
                    Guild
                  </label>
                  <button
                    onClick={() => setShowGuildDropdown(!showGuildDropdown)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-(--input-bg) border border-(--card-border) rounded-lg text-sm text-left"
                  >
                    <span
                      className={
                        selectedGuild
                          ? 'text-primary-wh40k'
                          : 'text-(--text-tertiary)'
                      }
                    >
                      {selectedGuild ? selectedGuild.guild_name : 'All guilds'}
                    </span>
                    <ChevronDown className="h-4 w-4 text-(--text-tertiary)" />
                  </button>

                  {showGuildDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-(--card-bg) border border-(--card-border) rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      <button
                        onClick={() => {
                          setFilterGuild('')
                          setShowGuildDropdown(false)
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-(--bg-secondary) text-secondary-wh40k"
                      >
                        All guilds
                      </button>
                      {guilds.map((guild) => (
                        <button
                          key={guild.guild_code}
                          onClick={() => selectGuild(guild.guild_code)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-(--bg-secondary) border-t border-(--card-border)"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-primary-wh40k">
                              {guild.guild_name}
                            </span>
                            <span className="text-xs text-(--text-tertiary)">
                              {guild.accounts_count}/{guild.member_count}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-secondary-wh40k mb-1 block">
                    Game Role
                  </label>
                  <select
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="w-full px-3 py-2 bg-(--input-bg) border border-(--card-border) rounded-lg text-sm text-primary-wh40k"
                  >
                    <option value="">All roles</option>
                    {GAME_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-secondary-wh40k mb-1 block">
                    Has Account
                  </label>
                  <select
                    value={filterHasAccount}
                    onChange={(e) =>
                      setFilterHasAccount(
                        e.target.value as 'all' | 'yes' | 'no'
                      )
                    }
                    className="w-full px-3 py-2 bg-(--input-bg) border border-(--card-border) rounded-lg text-sm text-primary-wh40k"
                  >
                    <option value="all">All</option>
                    <option value="yes">With account</option>
                    <option value="no">Without account</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilterGuild('')
                      setFilterRole('')
                      setFilterHasAccount('all')
                      setSearchQuery('')
                    }}
                    className="w-full"
                  >
                    Clear Filters
                  </Button>
                </div>
              </div>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="flex items-center justify-between text-sm text-secondary-wh40k">
              <span>
                Showing {searchResults.length} of {searchTotal} users
                {selectedUsers.size > 0 && (
                  <span className="ml-2 text-(--primary)">
                    ({selectedUsers.size} selected)
                  </span>
                )}
              </span>
              <button
                onClick={toggleAllVisible}
                className="flex items-center gap-1 hover:text-primary-wh40k"
              >
                {allVisibleSelected ? (
                  <CheckSquare className="h-4 w-4" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                {allVisibleSelected ? 'Deselect all' : 'Select all visible'}
              </button>
            </div>
          )}

          <div className="max-h-[400px] overflow-y-auto border border-(--card-border) rounded-lg">
            {searchResults.length === 0 ? (
              <div className="p-8 text-center text-secondary-wh40k">
                {searching
                  ? 'Searching...'
                  : 'No users found. Try different search terms or filters.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-(--bg-secondary) sticky top-0">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-wh40k">
                      User
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-wh40k">
                      Guild
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-wh40k">
                      Role
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-secondary-wh40k">
                      Status
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-secondary-wh40k">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((user, idx) => {
                    const badges = getRoleBadges(user)
                    const isSelected = user.user_id
                      ? selectedUsers.has(user.user_id)
                      : false
                    const canSelect = !!user.user_id

                    return (
                      <tr
                        key={user.id || user.user_id || idx}
                        className={`border-t border-(--card-border) ${isSelected ? 'bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]' : 'hover:bg-(--bg-secondary)'}`}
                      >
                        <td className="px-3 py-2">
                          {canSelect && (
                            <button
                              onClick={() => toggleUserSelection(user.user_id!)}
                            >
                              {isSelected ? (
                                <CheckSquare className="h-4 w-4 text-(--primary)" />
                              ) : (
                                <Square className="h-4 w-4 text-(--text-tertiary)" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {user.avatar_url ? (
                              <img
                                src={user.avatar_url}
                                alt=""
                                className="w-8 h-8 rounded-full"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-(--bg-tertiary) flex items-center justify-center">
                                <Users className="h-4 w-4 text-(--text-tertiary)" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-medium text-primary-wh40k truncate">
                                {user.display_name ||
                                  user.username ||
                                  'Unknown'}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-(--text-tertiary)">
                                {user.email && (
                                  <span className="flex items-center gap-1 truncate">
                                    <Mail className="h-3 w-3" />
                                    {user.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {user.guild_code ? (
                            <div className="flex items-center gap-1 text-secondary-wh40k">
                              <BuildingComplex className="h-3 w-3" />
                              {formatGuildDisplayLabel(null, user.guild_code)}
                            </div>
                          ) : (
                            <span className="text-(--text-tertiary)">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {user.role ? (
                            <span className="px-2 py-0.5 rounded-sm text-xs bg-(--bg-tertiary) text-secondary-wh40k capitalize">
                              {user.role}
                            </span>
                          ) : (
                            <span className="text-(--text-tertiary)">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            {user.user_id ? (
                              <span className="flex items-center gap-1 text-xs text-green-400">
                                <UserCheck className="h-3 w-3" />
                                Account
                              </span>
                            ) : (
                              <span className="text-xs text-(--text-tertiary)">
                                No account
                              </span>
                            )}
                            {badges.map((badge) => (
                              <span
                                key={badge.label}
                                className={`text-xs px-1.5 py-0.5 rounded-sm ${badge.color}`}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canSelect && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onBanUser(user)}
                              disabled={user.is_app_admin}
                              title={
                                user.is_app_admin
                                  ? 'Remove the app admin role before banning this user'
                                  : `Ban ${user.display_name || user.email || 'user'}`
                              }
                              className="gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10 disabled:opacity-40"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Ban
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {(selectedUsers.size > 0 || filterGuild) && (
        <Card className="border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5 text-(--primary)" />
              Bulk Actions
              <span className="text-sm font-normal text-secondary-wh40k">
                (
                {selectedUsers.size > 0
                  ? `${selectedUsers.size} selected`
                  : `All ${selectedGuild?.guild_name} members`}
                )
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs font-medium text-secondary-wh40k mb-1 block">
                  Action
                </label>
                <select
                  value={bulkAction}
                  onChange={(e) =>
                    setBulkAction(e.target.value as 'add' | 'remove')
                  }
                  className="px-3 py-2 bg-(--input-bg) border border-(--card-border) rounded-lg text-sm text-primary-wh40k"
                >
                  <option value="add">Add to role</option>
                  <option value="remove">Remove from role</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-secondary-wh40k mb-1 block">
                  Role
                </label>
                <select
                  value={bulkRoleType}
                  onChange={(e) => setBulkRoleType(e.target.value as RoleType)}
                  className="px-3 py-2 bg-(--input-bg) border border-(--card-border) rounded-lg text-sm text-primary-wh40k"
                >
                  <option value="alpha_tester">Alpha Tester</option>
                  <option value="beta_tester">Beta Tester</option>
                  <option value="admin">App Admin</option>
                </select>
              </div>

              {bulkAction === 'add' && (
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs font-medium text-secondary-wh40k mb-1 block">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={bulkNotes}
                    onChange={(e) => setBulkNotes(e.target.value)}
                    placeholder="Optional notes..."
                    className="w-full px-3 py-2 bg-(--input-bg) border border-(--card-border) rounded-lg text-sm text-primary-wh40k"
                  />
                </div>
              )}

              <Button
                onClick={executeBulkAction}
                disabled={processing}
                className={
                  bulkAction === 'add'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }
              >
                {processing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : bulkAction === 'add' ? (
                  <>
                    <UserPlus className="h-4 w-4 mr-1" />
                    Add to{' '}
                    {bulkRoleType === 'admin'
                      ? 'Admins'
                      : bulkRoleType === 'beta_tester'
                        ? 'Beta'
                        : 'Alpha'}
                  </>
                ) : (
                  <>
                    <Trash className="h-4 w-4 mr-1" />
                    Remove from{' '}
                    {bulkRoleType === 'admin'
                      ? 'Admins'
                      : bulkRoleType === 'beta_tester'
                        ? 'Beta'
                        : 'Alpha'}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
