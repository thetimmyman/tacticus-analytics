// Only native operation/scope/path values survive an unlock navigation. Every
// attempt obtains a fresh session through perform; no password/token is retained.
function createNativeActions({ perform, unlock, failed }) {
  let retry,
    busy = false
  const run = async (operation, scope, path) => {
    if (busy) return
    busy = true
    retry = undefined
    let needsUnlock = false,
      result
    try {
      result = await perform(operation, scope, path)
    } catch (error) {
      if (error.code === 'ESESSION') {
        retry = { operation, scope, path }
        needsUnlock = true
      } else await failed(error, operation)
    } finally {
      busy = false
    }
    // Release the action before navigating: did-finish-load may resume it while
    // loadURL is still pending. Releasing in a later finally would drop the retry.
    if (needsUnlock) await unlock()
    return result
  }
  const resume = async () => {
    if (!retry) return false
    if (busy) return true
    const action = retry
    retry = undefined
    await run(action.operation, action.scope, action.path)
    return true
  }
  return { run, resume }
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
