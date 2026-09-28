'use client'

/** Discord ping-role rows ({id,label}) with a reuse menu. */
import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  newDraftRole,
  roleRowKey,
  sanitizeRoleIdInput
} from '@/app/lib/boss-ops/roles'
import type { OpsRoleEntry, ReusableRole } from './types'

export function RoleListInput({
  label,
  roles,
  reusableRoles,
  disabled,
  onRememberRoles,
  onChange
}: {
  label: string
  roles: OpsRoleEntry[]
  reusableRoles: ReusableRole[]
  disabled: boolean
  onRememberRoles: (roles: OpsRoleEntry[]) => void
  onChange: (roles: OpsRoleEntry[]) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')
  const menuRootRef = useRef<HTMLDivElement | null>(null)
  const visibleRoles = roles.length > 0 ? roles : []
  const selectedIds = new Set(roles.map((role) => role.id).filter(Boolean))
  const normalizedSearch = roleSearch.trim().toLowerCase()
  const filteredReusableRoles = reusableRoles
    .filter((role) => !selectedIds.has(role.id))
    .filter((role) => {
      if (!normalizedSearch) return true
      return (
        role.id.includes(normalizedSearch) ||
        role.label.toLowerCase().includes(normalizedSearch)
      )
    })
    .slice(0, 10)

  useEffect(() => {
    if (!menuOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRootRef.current?.contains(target)) {
        return
      }
      setMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [menuOpen])

  const commit = (next: OpsRoleEntry[]) => {
    const cleaned = next
      .map((role) => ({
        id: sanitizeRoleIdInput(role.id),
        label: role.label,
        clientKey: role.clientKey
      }))
      .filter((role) => role.id.length > 0 || role.label.trim().length > 0)
    const seen = new Set<string>()
    const deduped: OpsRoleEntry[] = []
    for (const role of cleaned) {
      if (!role.id) {
        deduped.push(role)
        continue
      }
      if (seen.has(role.id)) continue
      seen.add(role.id)
      deduped.push(role)
    }
    onRememberRoles(deduped)
    onChange(deduped)
  }

  const patchAt = (index: number, patch: Partial<OpsRoleEntry>) => {
    const next = visibleRoles.map((role, i) =>
      i === index ? { ...role, ...patch } : role
    )
    commit(next)
  }

  const removeAt = (index: number) => {
    commit(visibleRoles.filter((_, i) => i !== index))
  }

  const addRole = () => {
    onChange([...roles, newDraftRole()])
    setRoleSearch('')
    setMenuOpen(false)
  }

  const selectReusableRole = (role: ReusableRole) => {
    commit([
      ...roles,
      {
        id: role.id,
        label: role.label,
        clientKey: `role-${role.id}`
      }
    ])
    setRoleSearch('')
    setMenuOpen(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
          {label}
        </div>
        {!disabled && (
          <div ref={menuRootRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-(--card-border) bg-black/15 px-2 text-xs font-semibold text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_55%,transparent)] hover:text-(--accent)"
            >
              <Plus className="h-3.5 w-3.5" />
              Role
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-50 w-72 rounded-md border border-[color-mix(in_srgb,var(--card-border)_85%,var(--text-primary)_15%)] bg-(--dropdown-bg-solid) p-2 shadow-2xl shadow-black/60">
                <input
                  value={roleSearch}
                  onChange={(event) => setRoleSearch(event.target.value)}
                  placeholder="Search saved roles"
                  className="mb-2 h-8 w-full rounded-md border border-(--card-border) bg-(--input-bg) px-2 text-xs text-primary-wh40k placeholder-[color-mix(in_srgb,var(--text-secondary)_65%,transparent)] focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={addRole}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-primary-wh40k hover:bg-(--hover-bg)"
                >
                  <Plus className="h-3.5 w-3.5 text-(--accent)" />
                  Create new role
                </button>
                {filteredReusableRoles.length > 0 && (
                  <div className="mt-1 max-h-56 space-y-1 overflow-auto border-t border-(--card-border) pt-1">
                    {filteredReusableRoles.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => selectReusableRole(role)}
                        className="block w-full rounded-md px-2 py-2 text-left hover:bg-(--hover-bg)"
                      >
                        <span className="block truncate text-xs font-semibold text-primary-wh40k">
                          {role.label || role.id}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-(--text-tertiary)">
                          {role.id}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {visibleRoles.length === 0 ? (
        <div className="rounded-md border border-(--card-border) bg-black/20 px-3 py-2 text-xs italic text-(--text-tertiary)">
          No roles configured.
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRoles.map((role, index) => (
            <div
              key={roleRowKey(role)}
              className="grid grid-cols-1 gap-2 rounded-md border border-(--card-border) bg-black/20 p-2 sm:grid-cols-[minmax(120px,0.38fr)_minmax(0,1fr)_2rem]"
            >
              <input
                value={role.label}
                disabled={disabled}
                onChange={(event) =>
                  patchAt(index, { label: event.target.value })
                }
                placeholder="Label"
                className="h-9 min-w-0 rounded-md border border-(--card-border) bg-black/20 px-2 text-sm text-primary-wh40k placeholder-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus:outline-hidden disabled:opacity-50"
              />
              <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-(--card-border) bg-black/20 px-2 focus-within:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]">
                <span className="font-mono text-sm text-[color-mix(in_srgb,var(--text-secondary)_70%,transparent)]">
                  @
                </span>
                <input
                  value={role.id}
                  disabled={disabled}
                  onChange={(event) =>
                    patchAt(index, {
                      id: sanitizeRoleIdInput(event.target.value)
                    })
                  }
                  placeholder="Discord role ID"
                  inputMode="numeric"
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-primary-wh40k placeholder-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] focus:outline-hidden disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeAt(index)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--card-border) bg-black/15 text-secondary-wh40k hover:border-red-300/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={`Remove ${label} ${index + 1}`}
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
