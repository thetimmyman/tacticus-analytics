// Hosted credential forms and key handlers need a qualified native adapter before they can be served locally.
export function rendererCredentialSurface(url) {
  let path
  try {
    path = decodeURIComponent(url.pathname)
      .replaceAll('\\', '/')
      .replace(/\/+$/u, '')
      .toLowerCase()
    if (/%[a-f0-9]{2}/i.test(path)) return true
  } catch {
    return true
  }
  return (
    (path === '/api/guild-tokens' && url.searchParams.get('live') === 'true') ||
    [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/change-password',
      '/api/auth/reset-password',
      '/auth/change-password',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/api-keys',
      '/profile',
      '/onboarding',
      '/token-usage',
      '/roster',
      '/guild-management/settings',
      '/guild-management/members',
      '/guild-settings',
      '/guild-ops/cluster-management',
      '/clusters/create',
      '/api/onboarding',
      '/api/profile',
      '/api/guild-settings',
      '/api/clusters/create',
      '/api/clusters/join',
      '/api/guild/claim',
      '/api/guild/create-config',
      '/api/guild/initial-sync',
      '/api/guild/trigger-sync',
      '/api/guild-tokens/sync',
      '/api/guild-teams/backfill',
      '/api/player/roster',
      '/api/player/achievements',
      '/api/members/roster',
      '/api/tokens',
      '/api/roster-development/analysis',
      '/api/roster-development/member-gaps',
      '/api/meta/player-recommendations',
      '/api/members/token-usage',
      '/api/guild-teams/tokens',
      '/api/guild-raid/unified-assignments',
      '/api/discord-webhooks/cap-notification',
      '/api/admin/diagnostics'
    ].some((prefix) => path === prefix || path.startsWith(prefix + '/')) ||
    ((path.startsWith('/api/') || path.startsWith('/supabase/rest/v1/')) &&
      /api[-_]?key/i.test(path))
  )
}
export function holdCredentialSurface(req, res, url) {
  if (!rendererCredentialSurface(url)) return false
  res.writeHead(501, {
    'content-type':
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/supabase/')
        ? 'application/json'
        : 'text/html',
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  })
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/supabase/'))
    res.end(
      JSON.stringify({
        error:
          'Use secure native input from your local workspace. This Windows feature is not yet available.'
      })
    )
  else
    res.end(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Local workspace</title><h1>This feature is not yet available in the Windows candidate</h1><p>Official API connections use secure native input. Your retained data remains local.</p><p><a href="/desktop/setup">Open your local workspace</a></p></html>'
    )
  return true
}
