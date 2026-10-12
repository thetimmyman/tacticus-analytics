import { workspaceGameConnection } from '../../launcher/game-connection.mjs'

// The add-on manager asks the loopback coordinator for the signed workspace
// owner. Only that fixed route is exposed: the shared handler also serves the
// official-connection routes, which this platform does not offer yet.
export function macAddonContext(services, options) {
  const shared = workspaceGameConnection(services, options)
  return async (req, res, url) =>
    req.method === 'POST' && url.pathname === '/desktop/addon-context'
      ? shared(req, res, url)
      : false
}
