// "API Key Owner" label. `API_Owner` is free text that may hold an email (PII):
// prefer the player's display name, else the raw label with emails masked.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function looksLikeEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

/** Mask an email's local part, e.g. "player746@example.com" -> "p•••@example.com". */
export function maskEmail(value: string): string {
  const trimmed = value.trim()
  const atIndex = trimmed.indexOf('@')
  if (atIndex <= 0) {
    return '•••'
  }
  const local = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex) // includes '@'
  return `${local[0]}•••${domain}`
}

/** Priority: display name > masked email > raw owner text > null. */
export function resolveApiOwnerDisplay(
  rawOwner: string | null | undefined,
  playerDisplayName: string | null | undefined
): string | null {
  const player = playerDisplayName?.trim()
  if (player) {
    return player
  }

  const owner = rawOwner?.trim()
  if (!owner) {
    return null
  }

  if (looksLikeEmail(owner)) {
    return maskEmail(owner)
  }

  return owner
}
