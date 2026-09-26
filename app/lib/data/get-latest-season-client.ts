'use client'

/** Uses the API route: as `authenticated`, RLS on EOT_GR_data forces a slow seq scan. */
export async function getLatestSeasonClient(): Promise<string | null> {
  try {
    const res = await fetch('/api/season/latest')
    if (!res.ok) return null
    const body = (await res.json()) as { season?: unknown }
    return typeof body.season === 'string' && body.season.length > 0
      ? body.season
      : null
  } catch {
    return null
  }
}
