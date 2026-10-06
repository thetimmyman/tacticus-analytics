/** Allow-list: the export RPC returns the whole row, including password hash and recovery tokens. */
const GDPR_EXPORT_PROFILE_FIELDS = [
  'id',
  'email',
  'created_at',
  'last_sign_in_at'
] as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A `profile` object is filtered even when the bundle shape is unexpected. */
export function projectExportBundle(bundle: unknown): unknown {
  if (!isPlainRecord(bundle)) return bundle
  const data = bundle.data
  if (!isPlainRecord(data)) return bundle
  const profile = data.profile
  if (!isPlainRecord(profile)) return bundle

  const projected: Record<string, unknown> = {}
  for (const field of GDPR_EXPORT_PROFILE_FIELDS) {
    if (field in profile) projected[field] = profile[field]
  }

  return { ...bundle, data: { ...data, profile: projected } }
}
