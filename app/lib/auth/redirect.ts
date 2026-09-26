/**
 * Open-redirect guard for user-supplied paths: after decoding, requires a single
 * leading `/`, no backslash (browsers normalise `\` to `/`) and no control
 * characters. Returns the decoded path or null. Bare `startsWith('/')` is not enough.
 */
export function validateRedirectPath(raw: string | null): string | null {
  if (!raw) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!decoded.startsWith('/')) return null
  if (decoded.startsWith('//')) return null
  if (decoded.includes('\\')) return null
  // Browsers strip tab/LF/CR, turning "/\n/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null
  return decoded
}
