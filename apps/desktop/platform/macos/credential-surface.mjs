// These legacy hosted forms accept API keys in renderer state. Until their
// native adapters are qualified, the desktop serves a holding response before
// any page or corresponding write handler can render or consume credentials.
export function rendererCredentialSurface(url) {
  let path
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+$/u, '')
  } catch {
    return true
  }
  return (
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
      '/api/onboarding',
      '/api/profile',
      '/api/guild-settings'
    ].some((prefix) => path === prefix || path.startsWith(prefix + '/')) ||
    (path.startsWith('/api/') && /api[-_]?key/i.test(path))
  )
}
