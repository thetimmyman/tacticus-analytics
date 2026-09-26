'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Loader2,
  ShieldOff
} from 'lucide-react'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import type { BanSubjectType } from '@/app/lib/auth/user-bans'
import type { UserResult } from './user-manager-shared'

interface BanRow {
  id: string
  ban_group_id: string
  auth_user_id: string
  subject_type: BanSubjectType
  subject_value: string
  reason: string | null
  banned_by: string | null
  banned_at: string
  expires_at: string | null
  lifted_at: string | null
  lifted_by: string | null
  lift_reason: string | null
}

interface BanGroup {
  id: string
  rows: BanRow[]
  reason: string | null
  bannedAt: string
  expiresAt: string | null
  liftedAt: string | null
  liftReason: string | null
  status: 'active' | 'expired' | 'lifted'
}

const SUBJECT_LABELS: Record<BanSubjectType, string> = {
  user_id: 'Supabase user',
  email: 'Email address',
  discord_user_id: 'Discord identity',
  player_id: 'Tacticus player'
}

export function formatLocalDateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes())
  ].join('')
}

function groupBans(rows: BanRow[]): BanGroup[] {
  const groups = new Map<string, BanRow[]>()
  for (const row of rows) {
    const group = groups.get(row.ban_group_id) ?? []
    group.push(row)
    groups.set(row.ban_group_id, group)
  }

  const now = Date.now()
  return [...groups.entries()].map(([id, groupRows]) => {
    const first = groupRows[0]!
    const liftedAt = first.lifted_at
    const expired =
      first.expires_at !== null && Date.parse(first.expires_at) <= now
    return {
      id,
      rows: groupRows,
      reason: first.reason,
      bannedAt: first.banned_at,
      expiresAt: first.expires_at,
      liftedAt,
      liftReason: first.lift_reason,
      status: liftedAt ? 'lifted' : expired ? 'expired' : 'active'
    }
  })
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

interface BanUserDialogProps {
  target: UserResult
  onClose: () => void
  onBanned: (message: string) => void
}

export function BanUserDialog({
  target,
  onClose,
  onBanned
}: BanUserDialogProps) {
  const availableSubjects = useMemo(
    () =>
      [
        ['user_id', target.user_id],
        ['email', target.email],
        ['discord_user_id', target.discord_user_id],
        ['player_id', target.player_id]
      ] as const,
    [target]
  )
  const [selectedTypes, setSelectedTypes] = useState<Set<BanSubjectType>>(
    () =>
      new Set(
        availableSubjects
          .filter(([, value]) => Boolean(value))
          .map(([type]) => type)
      )
  )
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleSubject = (type: BanSubjectType) => {
    setSelectedTypes((previous) => {
      const next = new Set(previous)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const submitBan = async () => {
    if (!target.user_id) return
    if (selectedTypes.size === 0) {
      setError('Select at least one identifier to ban')
      return
    }
    if (!reason.trim()) {
      setError('Enter a reason for the audit trail')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/users/bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: target.user_id,
          subject_types: [...selectedTypes],
          reason: reason.trim(),
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Failed to ban user'))
      }

      const appliedCount = Array.isArray(data.bans) ? data.bans.length : 0
      const unresolved = Array.isArray(data.unresolved)
        ? data.unresolved.map((type: BanSubjectType) => SUBJECT_LABELS[type])
        : []
      onBanned(
        `Banned ${target.display_name || target.email || 'user'} across ${appliedCount} identifier${appliedCount === 1 ? '' : 's'}${unresolved.length > 0 ? `; unavailable: ${unresolved.join(', ')}` : ''}`
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to ban user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      size="md"
      onClose={submitting ? undefined : onClose}
      titleId="ban-user-title"
      descriptionId="ban-user-description"
      closeLabel="Cancel ban"
    >
      <div className="pr-10">
        <h2
          id="ban-user-title"
          className="flex items-center gap-2 text-xl font-bold text-red-400"
        >
          <Ban className="h-5 w-5" />
          Ban user
        </h2>
        <p
          id="ban-user-description"
          className="mt-2 text-sm text-[var(--text-secondary)]"
        >
          Block {target.display_name || target.email || 'this user'} from
          signing in and from using an existing session. Select the identifiers
          that should continue to match if they create another login.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Block by identifier
        </legend>
        {availableSubjects.map(([type, value]) => (
          <label
            key={type}
            className={`flex items-start gap-3 rounded-lg border p-3 ${value ? 'cursor-pointer border-[var(--card-border)] bg-[var(--bg-secondary)]' : 'cursor-not-allowed border-[var(--card-border)] opacity-50'}`}
          >
            <input
              type="checkbox"
              checked={selectedTypes.has(type)}
              disabled={!value || submitting}
              onChange={() => toggleSubject(type)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--text-primary)]">
                {SUBJECT_LABELS[type]}
              </span>
              <span className="block truncate text-xs text-[var(--text-tertiary)]">
                {value || 'Not linked to this account'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <label
          htmlFor="ban-reason"
          className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
        >
          Reason
        </label>
        <textarea
          id="ban-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={submitting}
          maxLength={1000}
          rows={3}
          placeholder="Required; visible only to app admins"
          className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </div>

      <div>
        <label
          htmlFor="ban-expiry"
          className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
        >
          Expires (optional)
        </label>
        <input
          id="ban-expiry"
          type="datetime-local"
          value={expiresAt}
          min={formatLocalDateTimeInputValue(new Date(Date.now() + 60_000))}
          onChange={(event) => setExpiresAt(event.target.value)}
          disabled={submitting}
          className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={submitBan}
          disabled={submitting || selectedTypes.size === 0 || !reason.trim()}
          className="gap-2 bg-red-600 hover:bg-red-700"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Ban className="h-4 w-4" />
          )}
          Ban user
        </Button>
      </div>
    </ModalShell>
  )
}

interface BannedUsersTabProps {
  refreshToken: number
  onLifted: (message: string) => void
}

export function BannedUsersTab({
  refreshToken,
  onLifted
}: BannedUsersTabProps) {
  const [activeRows, setActiveRows] = useState<BanRow[]>([])
  const [historyRows, setHistoryRows] = useState<BanRow[]>([])
  const [nextHistoryCursor, setNextHistoryCursor] = useState<string | null>(
    null
  )
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [lifting, setLifting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchBans = useCallback(async (historyCursor: string | null = null) => {
    if (historyCursor === null) setLoading(true)
    else setLoadingMore(true)
    setError(null)
    try {
      const fetchPage = async (cursor: string | null) => {
        const params = new URLSearchParams({ history_limit: '100' })
        if (cursor) params.set('history_cursor', cursor)
        const response = await fetch(
          `/api/admin/users/bans?${params.toString()}`
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(extractErrorMessage(data, 'Failed to load bans'))
        }
        return data
      }

      // Refresh the newest page too, or a ban lifted between clicks loses its audit row.
      const [data, recentData] = historyCursor
        ? await Promise.all([fetchPage(historyCursor), fetchPage(null)])
        : [await fetchPage(null), null]
      const activeSnapshot = recentData ?? data
      const nextActiveRows = Array.isArray(activeSnapshot.activeBans)
        ? activeSnapshot.activeBans
        : []
      const nextHistoryRows = Array.isArray(data.historyBans)
        ? data.historyBans
        : []
      const recentHistoryRows = Array.isArray(recentData?.historyBans)
        ? recentData.historyBans
        : []
      setActiveRows(nextActiveRows)
      setHistoryRows((current) => {
        if (historyCursor === null) return nextHistoryRows
        const rowsById = new Map(current.map((row) => [row.id, row]))
        for (const row of recentHistoryRows as BanRow[]) {
          rowsById.set(row.id, row)
        }
        for (const row of nextHistoryRows) rowsById.set(row.id, row)
        return [...rowsById.values()]
      })
      setNextHistoryCursor(
        typeof data.nextHistoryCursor === 'string'
          ? data.nextHistoryCursor
          : null
      )
      setHistoryHasMore(data.historyHasMore === true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load bans')
    } finally {
      if (historyCursor === null) setLoading(false)
      else setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    fetchBans(null)
  }, [fetchBans, refreshToken])

  const liftBan = async (group: BanGroup) => {
    if (!confirm('Lift this ban across every identifier in the group?')) return
    const liftReason = prompt('Reason for lifting this ban (optional):')
    if (liftReason === null) return

    setLifting(group.id)
    setError(null)
    try {
      const response = await fetch('/api/admin/users/bans/lift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ban_group_id: group.id,
          lift_reason: liftReason.trim() || null
        })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Failed to lift ban'))
      }
      await fetchBans(null)
      onLifted(
        `Lifted ban across ${data.liftedCount} identifier${data.liftedCount === 1 ? '' : 's'}`
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to lift ban')
    } finally {
      setLifting(null)
    }
  }

  const groups = useMemo(
    () => groupBans([...activeRows, ...historyRows]),
    [activeRows, historyRows]
  )
  const visibleGroups = groups.filter(
    (group) => showHistory || group.status === 'active'
  )
  const activeCount = groups.filter((group) => group.status === 'active').length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldOff className="h-5 w-5 text-red-400" />
            Banned Users
            <span className="text-sm font-normal text-[var(--text-secondary)]">
              ({activeCount} active)
            </span>
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory((value) => !value)}
            >
              {showHistory ? 'Hide history' : 'Show history'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchBans(null)}>
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : visibleGroups.length === 0 ? (
          <p className="py-10 text-center text-[var(--text-secondary)]">
            {showHistory ? 'No bans recorded.' : 'No active bans.'}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleGroups.map((group) => (
              <div
                key={group.id}
                className="rounded-lg border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${group.status === 'active' ? 'bg-red-500/15 text-red-400' : group.status === 'expired' ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'}`}
                      >
                        {group.status === 'active'
                          ? 'Active'
                          : group.status === 'expired'
                            ? 'Expired'
                            : 'Lifted'}
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)]">
                        Banned {formatDate(group.bannedAt)}
                      </span>
                      {group.expiresAt && (
                        <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                          <Clock className="h-3 w-3" />
                          Expires {formatDate(group.expiresAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-primary)]">
                      {group.reason || 'No reason recorded'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.rows.map((row) => (
                        <span
                          key={row.id}
                          className="max-w-full rounded border border-[var(--card-border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--text-secondary)]"
                        >
                          <span className="font-medium">
                            {SUBJECT_LABELS[row.subject_type]}:
                          </span>{' '}
                          <span className="break-all">{row.subject_value}</span>
                        </span>
                      ))}
                    </div>
                    {group.liftedAt && (
                      <p className="flex items-center gap-1 text-xs text-green-400">
                        <Check className="h-3 w-3" />
                        Lifted {formatDate(group.liftedAt)}
                        {group.liftReason ? ` — ${group.liftReason}` : ''}
                      </p>
                    )}
                  </div>
                  {group.status === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => liftBan(group)}
                      disabled={lifting === group.id}
                      className="gap-2"
                    >
                      {lifting === group.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Lift ban
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {showHistory && historyHasMore && nextHistoryCursor && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchBans(nextHistoryCursor)}
                  disabled={loadingMore}
                  className="gap-2"
                >
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  Load older history
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
