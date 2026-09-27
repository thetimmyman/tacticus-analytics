'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import {
  KeyRound,
  BuildingComplex,
  Search,
  ChevronDown,
  Copy,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Loader2,
  UserCheck,
  Clock,
  Ban,
  Plus
} from 'lucide-react'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

interface Guild {
  guild_code: string
  guild_name: string
  cluster_code: string | null
  member_count: number
  accounts_count: number
}

interface GuildMember {
  player_id: string
  display_name: string
  role: string | null
  has_account: boolean
  active_invite_code: { code: string; expires_at: string } | null
}

interface InviteCode {
  id: string
  code: string | null
  player_id: string
  display_name: string
  guild_code: string
  created_at: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

export function InviteCodeManager() {
  const hasMounted = useHasMounted()
  const [guilds, setGuilds] = useState<Guild[]>([])
  const [selectedGuild, setSelectedGuild] = useState<Guild | null>(null)
  const [members, setMembers] = useState<GuildMember[]>([])
  const [recentCodes, setRecentCodes] = useState<InviteCode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showGuildDropdown, setShowGuildDropdown] = useState(false)
  const [guildFilter, setGuildFilter] = useState('')
  const [generating, setGenerating] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowGuildDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchGuilds = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users/guilds')
      if (res.ok) {
        const data = await res.json()
        setGuilds(data.guilds || [])
      }
    } catch {
      setError('Failed to load guilds')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchMembers = useCallback(async (guildCode: string) => {
    setLoadingMembers(true)
    try {
      const res = await fetch(
        `/api/admin/invite-codes/guild-members?guild_code=${guildCode}`
      )
      if (res.ok) {
        const data = await res.json()
        setMembers(data.members || [])
      }
    } catch {
      setError('Failed to load guild members')
    } finally {
      setLoadingMembers(false)
    }
  }, [])

  const fetchRecentCodes = useCallback(async (guildCode?: string) => {
    try {
      const url = guildCode
        ? `/api/admin/invite-codes?guild_code=${guildCode}`
        : '/api/admin/invite-codes'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setRecentCodes(data.codes || [])
      }
    } catch {
      // Recent codes are best-effort.
    }
  }, [])

  useEffect(() => {
    fetchGuilds()
    fetchRecentCodes()
  }, [fetchGuilds, fetchRecentCodes])

  const selectGuild = (guild: Guild) => {
    setSelectedGuild(guild)
    setShowGuildDropdown(false)
    setGuildFilter('')
    fetchMembers(guild.guild_code)
    fetchRecentCodes(guild.guild_code)
  }

  const generateCode = async (member: GuildMember) => {
    if (!selectedGuild) return

    setGenerating(member.player_id)
    setError(null)

    try {
      const res = await fetch('/api/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: member.player_id,
          display_name: member.display_name,
          guild_code: selectedGuild.guild_code,
          expires_hours: 168
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(extractErrorMessage(data, 'Failed to generate code'))
      }

      setSuccess(`Generated code ${data.code} for ${member.display_name}`)
      fetchMembers(selectedGuild.guild_code)
      fetchRecentCodes(selectedGuild.guild_code)
      setTimeout(() => setSuccess(null), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate code')
    } finally {
      setGenerating(null)
    }
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch {
      setError('Failed to copy code')
    }
  }

  const revokeCode = async (codeId: string) => {
    if (!confirm('Revoke this invite code?')) return

    try {
      const res = await fetch(`/api/admin/invite-codes?id=${codeId}`, {
        method: 'DELETE'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(extractErrorMessage(data, 'Failed to revoke code'))
      }

      setSuccess('Code revoked')
      if (selectedGuild) {
        fetchMembers(selectedGuild.guild_code)
        fetchRecentCodes(selectedGuild.guild_code)
      }
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke code')
    }
  }

  const filteredGuilds = guilds.filter(
    (g) =>
      g.guild_name.toLowerCase().includes(guildFilter.toLowerCase()) ||
      g.guild_code.toLowerCase().includes(guildFilter.toLowerCase())
  )

  const unclaimedMembers = members.filter((m) => !m.has_account)
  const claimedMembers = members.filter((m) => m.has_account)

  const formatExpiry = (expiresAt: string) => {
    const exp = new Date(expiresAt)
    const now = new Date()
    const hoursLeft = Math.round(
      (exp.getTime() - now.getTime()) / (1000 * 60 * 60)
    )
    if (hoursLeft < 1) return 'Expires soon'
    if (hoursLeft < 24) return `${hoursLeft}h left`
    return `${Math.round(hoursLeft / 24)}d left`
  }

  const recentCodeColumns: DataTableColumn<InviteCode>[] = [
    {
      key: 'code',
      header: 'Code',
      sortable: false,
      render: (code) =>
        code.code ? (
          <button
            onClick={() => copyCode(code.code!)}
            className="font-mono text-[var(--text-primary)] hover:text-[var(--primary)] flex items-center gap-1"
          >
            {code.code}
            {copiedCode === code.code ? (
              <Check className="h-3 w-3 text-green-400" />
            ) : (
              <Copy className="h-3 w-3 text-[var(--text-tertiary)]" />
            )}
          </button>
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]">Redacted</span>
        )
    },
    {
      key: 'player',
      header: 'Player',
      sortable: false,
      render: (code) => (
        <span className="text-[var(--text-primary)]">{code.display_name}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: false,
      render: (code) =>
        code.used_at ? (
          <span className="flex items-center gap-1 text-green-400 text-xs">
            <UserCheck className="h-3 w-3" />
            Used
          </span>
        ) : code.revoked_at ? (
          <span className="flex items-center gap-1 text-red-400 text-xs">
            <Ban className="h-3 w-3" />
            Revoked
          </span>
        ) : new Date(code.expires_at) < new Date() ? (
          <span className="flex items-center gap-1 text-[var(--text-tertiary)] text-xs">
            <Clock className="h-3 w-3" />
            Expired
          </span>
        ) : (
          <span className="flex items-center gap-1 text-amber-400 text-xs">
            <Clock className="h-3 w-3" />
            {formatExpiry(code.expires_at)}
          </span>
        )
    },
    {
      key: 'created',
      header: 'Created',
      sortable: false,
      render: (code) => (
        <span className="text-xs text-[var(--text-tertiary)]">
          {hasMounted ? new Date(code.created_at).toLocaleDateString() : '—'}
        </span>
      )
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      render: (code) =>
        !code.used_at &&
        !code.revoked_at &&
        new Date(code.expires_at) > new Date() && (
          <button
            onClick={() => revokeCode(code.id)}
            className="text-red-400 hover:text-red-300"
          >
            <X className="h-4 w-4" />
          </button>
        )
    }
  ]

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-12 bg-[var(--bg-secondary)] rounded w-1/3" />
        <div className="h-[300px] bg-[var(--bg-secondary)] rounded" />
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BuildingComplex className="h-5 w-5" />
            Select Guild
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={dropdownRef} className="relative max-w-md">
            <button
              onClick={() => setShowGuildDropdown(!showGuildDropdown)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-[var(--dropdown-bg-solid)] border border-[var(--card-border)] rounded-lg text-left"
            >
              {selectedGuild ? (
                <div>
                  <span className="text-[var(--text-primary)] font-medium">
                    {selectedGuild.guild_name}
                  </span>
                  <span className="text-[var(--text-tertiary)] text-sm ml-2">
                    ({selectedGuild.accounts_count}/{selectedGuild.member_count}{' '}
                    claimed)
                  </span>
                </div>
              ) : (
                <span className="text-[var(--text-tertiary)]">
                  Select a guild...
                </span>
              )}
              <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
            </button>

            {showGuildDropdown && (
              <div className="absolute z-50 w-full mt-1 rounded-lg max-h-80 overflow-hidden dropdown-menu">
                <div className="p-2 border-b border-[var(--card-border)]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                    <input
                      type="text"
                      value={guildFilter}
                      onChange={(e) => setGuildFilter(e.target.value)}
                      placeholder="Search guilds..."
                      className="w-full pl-9 pr-3 py-2 bg-[var(--input-bg)] border border-[var(--card-border)] rounded text-sm text-[var(--text-primary)]"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {filteredGuilds.map((guild) => (
                    <button
                      key={guild.guild_code}
                      onClick={() => selectGuild(guild)}
                      className="w-full px-4 py-3 text-left hover:bg-[var(--bg-secondary)] border-b border-[var(--card-border)] last:border-0"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[var(--text-primary)] font-medium">
                            {formatGuildDisplayLabel(
                              {
                                display_name: guild.guild_name,
                                guild_code: guild.guild_code
                              },
                              guild.guild_code
                            )}
                          </span>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-sm ${guild.accounts_count === 0 ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}
                          >
                            {guild.accounts_count}/{guild.member_count}
                          </span>
                          {guild.accounts_count === 0 && (
                            <span className="block text-xs text-amber-400">
                              No accounts
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedGuild && (
        <>
          <Card className="border-amber-500/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <KeyRound className="h-5 w-5 text-amber-400" />
                  <span className="text-amber-400">Unclaimed Players</span>
                  <span className="text-sm font-normal text-[var(--text-secondary)]">
                    ({unclaimedMembers.length})
                  </span>
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchMembers(selectedGuild.guild_code)}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingMembers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : unclaimedMembers.length === 0 ? (
                <p className="text-center py-8 text-[var(--text-secondary)]">
                  All players in this guild have claimed their profiles!
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {unclaimedMembers.map((member) => (
                    <div
                      key={member.player_id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--card-border)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--text-primary)] text-sm font-medium truncate">
                            {member.display_name}
                          </span>
                          {member.role && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] capitalize">
                              {member.role}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {member.active_invite_code ? (
                          <>
                            <button
                              onClick={() =>
                                copyCode(member.active_invite_code!.code)
                              }
                              className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs hover:bg-green-500/20"
                            >
                              {copiedCode === member.active_invite_code.code ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              {member.active_invite_code.code}
                            </button>
                            <span className="text-xs text-[var(--text-tertiary)]">
                              {formatExpiry(
                                member.active_invite_code.expires_at
                              )}
                            </span>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => generateCode(member)}
                            disabled={generating === member.player_id}
                            className="gap-1 h-7 text-xs"
                          >
                            {generating === member.player_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                            Generate
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <UserCheck className="h-5 w-5 text-green-400" />
                <span className="text-green-400">Claimed Players</span>
                <span className="text-sm font-normal text-[var(--text-secondary)]">
                  ({claimedMembers.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {claimedMembers.length === 0 ? (
                <p className="text-center py-4 text-[var(--text-secondary)]">
                  No players have claimed their profiles yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {claimedMembers.map((member) => (
                    <div
                      key={member.player_id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-sm"
                    >
                      <UserCheck className="h-3 w-3 text-green-400" />
                      <span className="text-[var(--text-primary)]">
                        {member.display_name}
                      </span>
                      {member.role && (
                        <span className="text-xs text-green-400 capitalize">
                          {member.role}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {recentCodes.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="h-5 w-5" />
                  Recent Invite Codes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={recentCodeColumns}
                  rows={recentCodes.slice(0, 20)}
                  rowKey={(code) => code.id}
                  empty={<></>}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-blue-400" />
            <span className="text-blue-400">Admin Invite Codes</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-secondary)]">
            Use this tool to generate invite codes for guilds that have{' '}
            <strong className="text-amber-400">no existing users</strong>.
            Normally, guild leaders/officers generate codes for their members,
            but if no one has claimed a profile yet, this admin tool provides a
            bootstrap mechanism.
          </p>
          <div className="mt-3 text-xs text-[var(--text-tertiary)] space-y-1">
            <p>• Codes expire after 7 days by default</p>
            <p>
              • Each code is tied to a specific player and can only be used once
            </p>
            <p>
              • Give the code to the player - they enter it at /onboarding/claim
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
