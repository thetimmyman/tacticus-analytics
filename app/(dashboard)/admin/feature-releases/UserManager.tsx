'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { useDisclosure } from '@/app/lib/hooks/useDisclosure'
import { useClickOutside } from '@/app/lib/hooks/useClickOutside'
import {
  Users,
  Beaker,
  Zap,
  Shield,
  RefreshCw,
  Check,
  X,
  AlertTriangle,
  UserPlus,
  KeyRound,
  ShieldOff
} from 'lucide-react'
import {
  ROLE_TABS,
  type AdminUser,
  type Guild,
  type RoleType,
  type UserGrant,
  type UserResult,
  type ViewTab
} from './user-manager-shared'
import { UserManagerSearchTab } from './UserManagerSearchTab'
import { UserManagerRoleTab } from './UserManagerRoleTab'
import { InviteCodeManager } from './InviteCodeManager'
import { BanUserDialog, BannedUsersTab } from './UserBanManager'

export function UserManager() {
  const [activeTab, setActiveTab] = useState<ViewTab>('search')
  const [alphaTesters, setAlphaTesters] = useState<UserGrant[]>([])
  const [betaTesters, setBetaTesters] = useState<UserGrant[]>([])
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [guilds, setGuilds] = useState<Guild[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [banTarget, setBanTarget] = useState<UserResult | null>(null)
  const [banRefreshToken, setBanRefreshToken] = useState(0)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserResult[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())

  const [filterGuild, setFilterGuild] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterHasAccount, setFilterHasAccount] = useState<
    'all' | 'yes' | 'no'
  >('all')
  const { isOpen: showFilters, onToggle: toggleFilters } = useDisclosure(false)
  const {
    isOpen: showGuildDropdown,
    setIsOpen: setShowGuildDropdown,
    onClose: closeGuildDropdown
  } = useDisclosure(false)

  const [bulkAction, setBulkAction] = useState<'add' | 'remove'>('add')
  const [bulkRoleType, setBulkRoleType] = useState<RoleType>('alpha_tester')
  const [bulkNotes, setBulkNotes] = useState('')
  const [processing, setProcessing] = useState(false)

  const [filterQuery, setFilterQuery] = useState('')

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const guildDropdownRef = useRef<HTMLDivElement>(null)

  useClickOutside(guildDropdownRef, closeGuildDropdown)

  const fetchRoleData = useCallback(async () => {
    try {
      const [alphaRes, betaRes, adminsRes, guildsRes] = await Promise.all([
        fetch('/api/admin/alpha-testers'),
        fetch('/api/admin/beta-testers'),
        fetch('/api/admin/app-admins'),
        fetch('/api/admin/users/guilds')
      ])

      if (alphaRes.ok) {
        const data = await alphaRes.json()
        setAlphaTesters(data.testers || [])
      }

      if (betaRes.ok) {
        const data = await betaRes.json()
        setBetaTesters(data.testers || [])
      }

      if (adminsRes.ok) {
        const data = await adminsRes.json()
        setAdmins(data.admins || [])
      }

      if (guildsRes.ok) {
        const data = await guildsRes.json()
        setGuilds(data.guilds || [])
      }
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRoleData()
  }, [fetchRoleData])

  const searchUsers = useCallback(async () => {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('q', searchQuery)
      if (filterGuild) params.set('guild_code', filterGuild)
      if (filterRole) params.set('role', filterRole)
      if (filterHasAccount === 'yes') params.set('has_account', 'true')
      if (filterHasAccount === 'no') params.set('has_account', 'false')
      params.set('limit', '50')

      const res = await fetch(`/api/admin/users/search?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.users || [])
        setSearchTotal(data.total || 0)
      }
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [searchQuery, filterGuild, filterRole, filterHasAccount])

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (activeTab === 'search') {
      searchTimeoutRef.current = setTimeout(() => {
        searchUsers()
      }, 300)
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [
    searchQuery,
    filterGuild,
    filterRole,
    filterHasAccount,
    activeTab,
    searchUsers
  ])

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const toggleAllVisible = () => {
    const visibleUserIds = searchResults
      .filter((u) => u.user_id)
      .map((u) => u.user_id!)
    const allSelected = visibleUserIds.every((id) => selectedUsers.has(id))

    if (allSelected) {
      setSelectedUsers((prev) => {
        const next = new Set(prev)
        visibleUserIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelectedUsers((prev) => {
        const next = new Set(prev)
        visibleUserIds.forEach((id) => next.add(id))
        return next
      })
    }
  }

  const selectGuild = (guildCode: string) => {
    const guild = guilds.find((g) => g.guild_code === guildCode)
    if (guild) {
      setFilterGuild(guildCode)
      setShowGuildDropdown(false)
    }
  }

  const executeBulkAction = async () => {
    if (selectedUsers.size === 0 && !filterGuild) {
      setError('Select users or a guild first')
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: bulkAction,
          role_type: bulkRoleType,
          user_ids:
            selectedUsers.size > 0 ? Array.from(selectedUsers) : undefined,
          guild_code: selectedUsers.size === 0 ? filterGuild : undefined,
          notes: bulkNotes || null
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(extractErrorMessage(data, 'Operation failed'))
      }

      const roleLabelMap: Record<RoleType, string> = {
        admin: 'admin',
        alpha_tester: 'alpha tester',
        beta_tester: 'beta tester'
      }
      const roleLabel = roleLabelMap[bulkRoleType]
      setSuccess(
        `${bulkAction === 'add' ? 'Added' : 'Removed'} ${data.successCount} users ${bulkAction === 'add' ? 'as' : 'from'} ${roleLabel}s`
      )
      setSelectedUsers(new Set())
      setBulkNotes('')
      fetchRoleData()
      searchUsers()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setProcessing(false)
    }
  }

  const removeFromRole = async (email: string, roleType: RoleType) => {
    const labelMap: Record<RoleType, string> = {
      admin: 'admin',
      alpha_tester: 'alpha tester',
      beta_tester: 'beta tester'
    }
    const label = labelMap[roleType]
    if (!confirm(`Remove ${email} from ${label}s?`)) return

    try {
      setError(null)

      const endpointMap: Record<RoleType, string> = {
        admin: '/api/admin/app-admins/remove',
        alpha_tester: '/api/admin/alpha-testers/remove',
        beta_tester: '/api/admin/beta-testers/remove'
      }
      const endpoint = endpointMap[roleType]

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(extractErrorMessage(data, 'Failed to remove'))
      }

      fetchRoleData()
      setSuccess(`Removed ${email} from ${label}s`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user')
    }
  }

  const filterList = <
    T extends { email: string; display_name?: string | null }
  >(
    users: T[]
  ): T[] => {
    if (!filterQuery.trim()) return users
    const q = filterQuery.toLowerCase()
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.display_name && u.display_name.toLowerCase().includes(q))
    )
  }

  const getRoleBadges = (user: UserResult) => {
    const badges = []
    if (user.is_app_admin)
      badges.push({ label: 'Admin', color: 'bg-amber-500/20 text-amber-400' })
    if (user.is_alpha_tester)
      badges.push({ label: 'Alpha', color: 'bg-red-500/20 text-red-400' })
    if (user.is_beta_tester)
      badges.push({ label: 'Beta', color: 'bg-blue-500/20 text-blue-400' })
    return badges
  }

  const selectedGuild = guilds.find((g) => g.guild_code === filterGuild)
  const visibleUserIds = searchResults
    .filter((u) => u.user_id)
    .map((u) => u.user_id!)
  const allVisibleSelected =
    visibleUserIds.length > 0 &&
    visibleUserIds.every((id) => selectedUsers.has(id))

  const showSuccess = (message: string) => {
    setSuccess(message)
    setTimeout(() => setSuccess(null), 5000)
  }

  const handleUserBanned = (message: string) => {
    setBanTarget(null)
    setBanRefreshToken((value) => value + 1)
    setSelectedUsers(new Set())
    setActiveTab('bans')
    showSuccess(message)
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-12 bg-(--bg-secondary) rounded-sm w-1/2" />
        <div className="h-[400px] bg-(--bg-secondary) rounded-sm" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
          <Check className="h-5 w-5 shrink-0" />
          {success}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('search')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
            activeTab === 'search'
              ? 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-(--primary)'
              : 'bg-(--bg-secondary) border-(--card-border) text-secondary-wh40k hover:text-primary-wh40k'
          }`}
        >
          <UserPlus className="h-4 w-4" />
          <span className="font-medium">Find & Add Users</span>
        </button>

        {ROLE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
              activeTab === tab.key
                ? `${tab.bg} ${tab.border} ${tab.color}`
                : 'bg-(--bg-secondary) border-(--card-border) text-secondary-wh40k hover:text-primary-wh40k'
            }`}
          >
            {tab.icon}
            <span className="font-medium">{tab.label}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-sm ${activeTab === tab.key ? 'bg-white/10' : 'bg-(--bg-tertiary)'}`}
            >
              {tab.key === 'alpha'
                ? alphaTesters.length
                : tab.key === 'beta'
                  ? betaTesters.length
                  : admins.length}
            </span>
          </button>
        ))}

        <button
          onClick={() => setActiveTab('bans')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
            activeTab === 'bans'
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-(--bg-secondary) border-(--card-border) text-secondary-wh40k hover:text-primary-wh40k'
          }`}
        >
          <ShieldOff className="h-4 w-4" />
          <span className="font-medium">Banned Users</span>
        </button>

        <button
          onClick={() => setActiveTab('invites')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
            activeTab === 'invites'
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
              : 'bg-(--bg-secondary) border-(--card-border) text-secondary-wh40k hover:text-primary-wh40k'
          }`}
        >
          <KeyRound className="h-4 w-4" />
          <span className="font-medium">Invite Codes</span>
        </button>

        <Button
          variant="outline"
          onClick={fetchRoleData}
          className="ml-auto gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {activeTab === 'search' && (
        <UserManagerSearchTab
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searching={searching}
          showFilters={showFilters}
          toggleFilters={toggleFilters}
          filterGuild={filterGuild}
          setFilterGuild={setFilterGuild}
          filterRole={filterRole}
          setFilterRole={setFilterRole}
          filterHasAccount={filterHasAccount}
          setFilterHasAccount={setFilterHasAccount}
          showGuildDropdown={showGuildDropdown}
          setShowGuildDropdown={setShowGuildDropdown}
          guildDropdownRef={guildDropdownRef}
          guilds={guilds}
          selectGuild={selectGuild}
          selectedGuild={selectedGuild}
          searchResults={searchResults}
          searchTotal={searchTotal}
          selectedUsers={selectedUsers}
          toggleUserSelection={toggleUserSelection}
          toggleAllVisible={toggleAllVisible}
          allVisibleSelected={allVisibleSelected}
          getRoleBadges={getRoleBadges}
          bulkAction={bulkAction}
          setBulkAction={setBulkAction}
          bulkRoleType={bulkRoleType}
          setBulkRoleType={setBulkRoleType}
          bulkNotes={bulkNotes}
          setBulkNotes={setBulkNotes}
          processing={processing}
          executeBulkAction={executeBulkAction}
          onBanUser={setBanTarget}
        />
      )}

      {ROLE_TABS.some((tab) => tab.key === activeTab) && (
        <UserManagerRoleTab
          activeTab={activeTab as 'alpha' | 'beta' | 'admins'}
          filterQuery={filterQuery}
          setFilterQuery={setFilterQuery}
          admins={admins}
          alphaTesters={alphaTesters}
          betaTesters={betaTesters}
          filterList={filterList}
          removeFromRole={removeFromRole}
        />
      )}

      {activeTab === 'bans' && (
        <BannedUsersTab refreshToken={banRefreshToken} onLifted={showSuccess} />
      )}

      {activeTab === 'invites' && <InviteCodeManager />}

      {banTarget && (
        <BanUserDialog
          target={banTarget}
          onClose={() => setBanTarget(null)}
          onBanned={handleUserBanned}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Access Level Reference
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/30">
              <div className="flex items-center gap-2 mb-1">
                <Beaker className="h-4 w-4 text-red-400" />
                <span className="font-semibold text-sm text-red-400">
                  Alpha Testers
                </span>
              </div>
              <p className="text-xs text-secondary-wh40k">
                Access to alpha-stage features. Internal team and trusted
                community members.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/30">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-blue-400" />
                <span className="font-semibold text-sm text-blue-400">
                  Beta Testers
                </span>
              </div>
              <p className="text-xs text-secondary-wh40k">
                Access to beta-stage features. Wider testing group for feature
                validation.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/30">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-4 w-4 text-amber-400" />
                <span className="font-semibold text-sm text-amber-400">
                  App Admins
                </span>
              </div>
              <p className="text-xs text-secondary-wh40k">
                Full admin access. Can manage users, features, and content.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
