// These legacy hosted forms accept API keys in renderer state. Until their
// native adapters are qualified, the desktop serves a holding response before
// any page or corresponding write handler can render or consume credentials.
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
