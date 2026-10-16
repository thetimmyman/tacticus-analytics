// Shared by the cluster join route and Cluster Management's edit form, so both
// refuse the same names. The display name is public (anon-readable), so an
// email typed into it by mistake would leak.

export const GUILD_DISPLAY_NAME_MAX_LENGTH = 64

// Unanchored: also catches an email embedded in a longer name.
const EMBEDDED_EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/

export type GuildDisplayNameResult =
  { ok: true; value: string } | { ok: false; error: string }

export function validateGuildDisplayName(raw: unknown): GuildDisplayNameResult {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) {
    return { ok: false, error: 'Guild display name is required' }
  }
  if (value.length > GUILD_DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Guild display name must be ${GUILD_DISPLAY_NAME_MAX_LENGTH} characters or fewer`
    }
  }
  if (EMBEDDED_EMAIL_PATTERN.test(value)) {
    return {
      ok: false,
      error: 'Guild display name must not be an email address'
    }
  }
  return { ok: true, value }
}
