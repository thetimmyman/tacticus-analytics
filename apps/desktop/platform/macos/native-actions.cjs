// Native operation/scope/path values stay in main during one automatic session
// recovery. Both attempts obtain current cookies; no credential is retained.
function createNativeActions({ perform, recover, failed }) {
  let busy = false
  const run = async (operation, scope, path) => {
    if (busy) return
    busy = true
    try {
      try {
        return await perform(operation, scope, path)
      } catch (error) {
        if (error.code !== 'ESESSION') throw error
        if (!(await recover())) throw error
        return await perform(operation, scope, path)
      }
    } catch (error) {
      await failed(error, operation)
    } finally {
      busy = false
    }
  }
  return { run }
}

async function exportCachedPersonal({
  path,
  requestSession,
  writeDestination
}) {
  const { personal } = await requestSession()
  if (!personal) throw new Error('Personal data unavailable')
  await writeDestination(
    path,
    JSON.stringify(
      {
        schemaVersion: 'macos-personal-export/v1',
        personal,
        freshness: {
          syncedAt: personal.upstreamUpdatedAt,
          offlineReadable: true
        }
      },
      null,
      2
    ),
    { mode: 0o600, flag: 'wx' }
  )
}

module.exports = { createNativeActions, exportCachedPersonal }
