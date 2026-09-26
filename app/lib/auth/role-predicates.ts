export function isOfficerLeaderOrAdminRole(
  role: string | null | undefined
): boolean {
  const normalizedRole = (role ?? '').toLowerCase()
  return (
    normalizedRole === 'officer' ||
    normalizedRole === 'leader' ||
    normalizedRole === 'admin'
  )
}

/**
 * Excludes `'admin'`: not an enum member, so it could only match a spoofed
 * `user_metadata.role` via `inferRole()`. The write routes have no admin branch.
 */
export function canManageHeraldRole(role: string | null | undefined): boolean {
  const normalizedRole = (role ?? '').toLowerCase()
  return normalizedRole === 'officer' || normalizedRole === 'leader'
}

/** Cluster leaders configure; officers edit. Lowercased like the SQL predicates. */
export function isClusterLeaderRole(role: string | null | undefined): boolean {
  return (role ?? '').toLowerCase() === 'leader'
}
