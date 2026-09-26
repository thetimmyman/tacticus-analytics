import type {
  OpsRoleEntry,
  ReusableRole
} from '@/app/components/boss-ops/types'

export const DISCORD_ROLE_ID_REGEX = /^\d{17,20}$/

export const primaryRoleId = (entries: OpsRoleEntry[]): string =>
  entries[0]?.id ?? ''

export const sanitizeRoleIdInput = (value: string): string =>
  value.replace(/[^0-9]/g, '')

export const newDraftRole = (): OpsRoleEntry => ({
  id: '',
  label: '',
  clientKey: `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
})

export const roleRowKey = (role: OpsRoleEntry): string =>
  role.clientKey ?? (role.id ? `role-${role.id}` : `draft-${role.label}`)

export const mergeReusableRoles = (
  base: ReusableRole[],
  roles: OpsRoleEntry[]
): ReusableRole[] => {
  const byId = new Map(base.map((role) => [role.id, role]))
  for (const role of roles) {
    const id = sanitizeRoleIdInput(role.id)
    if (!DISCORD_ROLE_ID_REGEX.test(id)) continue
    const label = role.label.trim()
    const existing = byId.get(id)
    if (!existing || (!existing.label && label)) {
      byId.set(id, { id, label })
    } else if (existing.label && label && existing.label !== label) {
      byId.set(id, { id, label })
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.label || a.id).localeCompare(b.label || b.id, undefined, {
      sensitivity: 'base'
    })
  )
}

/** Callers block the save: the RPC would reject the whole write. */
export const hasIncompleteRoleRows = (roles: OpsRoleEntry[]): boolean =>
  roles.some((role) => {
    const id = role.id.trim()
    if (!id && role.clientKey?.startsWith('draft-')) return true
    if (!id && role.label.trim().length > 0) return true
    return id.length > 0 && !DISCORD_ROLE_ID_REGEX.test(id)
  })
