'use client'

import { useEffect, useState } from 'react'
import { Switch, Button, Label } from '@tacticus/ui-kit'
import { UserCheck, Loader2, RefreshCw } from 'lucide-react'
import { useToast } from '@/app/hooks/useToast'
import { createComponentLogger } from '@/app/lib/logging/client'
import { cn } from '@/app/lib/utils/cn'

const logger = createComponentLogger(
  'guild-management.settings.RoleReconcilerSettings'
)

// Only ADDS roles and never touches a non-'auto' player_meta_roles row; "Resync now" ignores the toggle.

interface RoleReconcilerSettingsProps {
  guildCode: string
  canManage: boolean
  className?: string
}

type Tier = 'optimal' | 'strong' | 'suitable'

interface ConfigState {
  autoRoleAssignEnabled: boolean
  autoRoleAssignTier: Tier
}

interface ReconcileSummary {
  members_evaluated: number
  roles_added: number
  skipped_manual: number
  skipped_already_present: number
  skipped_no_discord_user: number
  skipped_threshold_not_met: number
  failed: number
  duration_ms: number
}

const DEFAULT_STATE: ConfigState = {
  autoRoleAssignEnabled: false,
  autoRoleAssignTier: 'strong'
}

const TIER_LABELS: Record<Tier, { title: string; helper: string }> = {
  optimal: {
    title: 'Optimal (100%)',
    helper:
      "A meta-team must be 100% covered by the member's roster before it can compete for a top-2 slot. Most conservative."
  },
  strong: {
    title: 'Strong (80%)',
    helper:
      'A meta-team must be at least 80% covered before it can compete for a top-2 slot. Balanced default.'
  },
  suitable: {
    title: 'Suitable (60%)',
    helper:
      'A meta-team must be at least 60% covered before it can compete for a top-2 slot. Most permissive.'
  }
}

export function RoleReconcilerSettings({
  guildCode,
  canManage,
  className
}: RoleReconcilerSettingsProps) {
  const { toast } = useToast()
  const [state, setState] = useState<ConfigState>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)
  const [savingToggle, setSavingToggle] = useState(false)
  const [savingTier, setSavingTier] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [lastResult, setLastResult] = useState<ReconcileSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `/api/guild-roles/config?guild_code=${encodeURIComponent(guildCode)}`,
          { cache: 'no-store' }
        )
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = (await response.json()) as ConfigState extends never
          ? never
          : {
              auto_role_assign_enabled: boolean
              auto_role_assign_tier: Tier
            }
        if (!cancelled) {
          setState({
            autoRoleAssignEnabled: data.auto_role_assign_enabled ?? false,
            autoRoleAssignTier: data.auto_role_assign_tier ?? 'strong'
          })
        }
      } catch (err) {
        logger.warn(
          { guildCode, err: err instanceof Error ? err.message : String(err) },
          'role_reconciler_settings.load_failed'
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [guildCode])

  const saveConfig = async (
    update: Partial<{
      auto_role_assign_enabled: boolean
      auto_role_assign_tier: Tier
    }>
  ): Promise<boolean> => {
    const response = await fetch('/api/guild-roles/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_code: guildCode, ...update })
    })
    if (!response.ok) {
      logger.warn(
        { guildCode, status: response.status, update },
        'role_reconciler_settings.save_failed'
      )
      return false
    }
    return true
  }

  const handleToggle = async (next: boolean) => {
    if (!canManage || savingToggle) return
    setSavingToggle(true)
    const prev = state.autoRoleAssignEnabled
    setState((s) => ({ ...s, autoRoleAssignEnabled: next })) // optimistic
    const ok = await saveConfig({ auto_role_assign_enabled: next })
    if (!ok) {
      setState((s) => ({ ...s, autoRoleAssignEnabled: prev })) // revert
      toast.error(
        'Failed to save',
        'Could not update auto role assignment toggle.'
      )
    } else {
      toast.success(
        next ? 'Auto role assignment enabled' : 'Auto role assignment disabled',
        next
          ? 'Roles will sync after each guild data refresh.'
          : 'Automatic role assignment is paused. Officers can still resync manually.'
      )
    }
    setSavingToggle(false)
  }

  const handleTierChange = async (tier: Tier) => {
    if (!canManage || savingTier) return
    if (tier === state.autoRoleAssignTier) return
    setSavingTier(true)
    const prev = state.autoRoleAssignTier
    setState((s) => ({ ...s, autoRoleAssignTier: tier })) // optimistic
    const ok = await saveConfig({ auto_role_assign_tier: tier })
    if (!ok) {
      setState((s) => ({ ...s, autoRoleAssignTier: prev })) // revert
      toast.error('Failed to save', 'Could not update qualification tier.')
    }
    setSavingTier(false)
  }

  const handleResync = async () => {
    if (!canManage || reconciling) return
    setReconciling(true)
    setLastResult(null)
    try {
      const response = await fetch('/api/guild-roles/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: guildCode })
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ''}`)
      }
      const data = (await response.json()) as { result: ReconcileSummary }
      setLastResult(data.result)
      toast.success(
        'Resync complete',
        `${data.result.roles_added} role${data.result.roles_added === 1 ? '' : 's'} added; ${data.result.members_evaluated} member${data.result.members_evaluated === 1 ? '' : 's'} evaluated.`
      )
    } catch (err) {
      logger.error(
        { guildCode, err: err instanceof Error ? err.message : String(err) },
        'role_reconciler_settings.resync_failed'
      )
      toast.error(
        'Resync failed',
        err instanceof Error ? err.message : 'Unknown error'
      )
    } finally {
      setReconciling(false)
    }
  }

  if (loading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 text-sm text-(--text-tertiary)',
          className
        )}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading role-reconciler settings…
      </div>
    )
  }

  return (
    <div className={cn('space-y-5', className)}>
      <div className="flex items-start gap-3">
        <UserCheck className="w-5 h-5 mt-0.5 text-(--accent) shrink-0" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-primary-wh40k">
            Auto-assign meta-team roles
          </h3>
          <p className="text-xs text-(--text-tertiary)">
            Picks each member&apos;s top 2 meta-teams by roster strength and
            assigns the Discord role only if they&apos;ve actually played that
            team — at least <strong>5 tokens across the last 3 seasons</strong>.
            Members who could field a top team but never play it stay
            unlabelled. Manually-set and leader-overridden roles are never
            touched. Default: <strong>off</strong>.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-4">
        <div>
          <Label className="font-semibold text-primary-wh40k">
            Enable auto role assignment
          </Label>
          <p className="text-xs text-(--text-tertiary) mt-1">
            When on, roles re-sync after each guild data refresh and after a new
            Discord link.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savingToggle && (
            <Loader2 className="w-4 h-4 animate-spin text-(--text-tertiary)" />
          )}
          <Switch
            checked={state.autoRoleAssignEnabled}
            onCheckedChange={handleToggle}
            disabled={!canManage || savingToggle}
          />
        </div>
      </div>

      <div
        className={cn(
          'rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-4 space-y-3',
          !state.autoRoleAssignEnabled && 'opacity-60'
        )}
      >
        <div>
          <Label className="font-semibold text-primary-wh40k">
            Qualification tier
          </Label>
          <p className="text-xs text-(--text-tertiary) mt-1">
            Capability floor for ranking. Only meta-teams above this match%
            compete for the top-2 slots — engagement (≥5 tokens, last 3 seasons)
            is then required for the role to actually assign.
          </p>
        </div>

        <div className="space-y-2">
          {(Object.keys(TIER_LABELS) as Tier[]).map((tier) => (
            <label
              key={tier}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors',
                state.autoRoleAssignTier === tier
                  ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                  : 'border-card-border/40 hover:bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)]',
                (!canManage || savingTier) && 'cursor-not-allowed'
              )}
            >
              <input
                type="radio"
                name="auto-role-assign-tier"
                value={tier}
                checked={state.autoRoleAssignTier === tier}
                onChange={() => handleTierChange(tier)}
                disabled={!canManage || savingTier}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-primary-wh40k">
                  {TIER_LABELS[tier].title}
                </div>
                <div className="text-xs text-(--text-tertiary) mt-0.5">
                  {TIER_LABELS[tier].helper}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={handleResync}
          disabled={!canManage || reconciling}
          variant="outline"
          className="flex items-center gap-2 rounded-xl border-[color-mix(in_srgb,var(--accent)_60%,transparent)] text-(--accent) hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
        >
          {reconciling ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Resyncing…
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              Resync now
            </>
          )}
        </Button>
        <span className="text-xs text-(--text-tertiary)">
          Officer override — runs the reconciler even when the toggle is off.
        </span>
      </div>

      {lastResult && (
        <div className="rounded-2xl border border-card-border/40 bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] p-4 text-xs text-secondary-wh40k">
          <div className="font-semibold text-primary-wh40k mb-2">
            Last resync result
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <SummaryLine
              label="Members evaluated"
              value={lastResult.members_evaluated}
            />
            <SummaryLine label="Roles added" value={lastResult.roles_added} />
            <SummaryLine
              label="Skipped (manual)"
              value={lastResult.skipped_manual}
            />
            <SummaryLine
              label="Skipped (already present)"
              value={lastResult.skipped_already_present}
            />
            <SummaryLine
              label="Skipped (no Discord link)"
              value={lastResult.skipped_no_discord_user}
            />
            <SummaryLine
              label="Skipped (threshold)"
              value={lastResult.skipped_threshold_not_met}
            />
            <SummaryLine label="Failed" value={lastResult.failed} />
            <SummaryLine label="Duration (ms)" value={lastResult.duration_ms} />
          </dl>
        </div>
      )}
    </div>
  )
}

interface SummaryLineProps {
  label: string
  value: number
}
function SummaryLine({ label, value }: SummaryLineProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-(--text-tertiary)">{label}</span>
      <span className="font-mono text-primary-wh40k">{value}</span>
    </div>
  )
}
