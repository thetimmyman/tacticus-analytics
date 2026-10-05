const { createHash, randomBytes } = require('node:crypto')
const { join } = require('node:path')

module.exports = async function gameMenu(window, config, dependencies = {}) {
  const { app, dialog, Menu, safeStorage, session } =
    dependencies.electron ?? require('electron')
  const { CredentialVault } = await import('./credential-vault.mjs')
  const { OfficialRaidBroker } = await import('./official-raid-broker.mjs')
  const nativeSecretPrompt =
    dependencies.nativeSecretPrompt ??
    (await import('./native-secret.mjs')).nativeSecretPrompt
  const { loadGameConnection, saveGameConnection, forgetGameConnection } =
    await import('./saved-game-connection.mjs')
  const { parseRaidFile } = await import('./raid-file-validation.mjs')
  const endpoint = new URL(config.url)
  const port = Number(endpoint.port)
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/desktop/setup' ||
    endpoint.search ||
    endpoint.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('Invalid local desktop destination')
  const origin = `http://127.0.0.1:${port}`
  if (
    ![config.transportKey, config.brokerToken].every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    )
  )
    throw new Error('Invalid local desktop authorization')
  const operations = new Set([
    '/desktop/broker-context',
    '/desktop/broker-status',
    '/desktop/import'
  ])
  // An ephemeral main-only partition carries local capabilities. Its requests
  // have no renderer cookies and cannot reach another origin or operation.
  const coordinator = session.fromPartition(
    'native-game-' + randomBytes(16).toString('hex')
  )
  const allowed = (address) => {
    const value = new URL(address)
    return (
      value.origin === origin &&
      !value.username &&
      !value.password &&
      !value.search &&
      !value.hash &&
      operations.has(value.pathname)
    )
  }
  coordinator.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowed(details.url) })
  })
  coordinator.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!allowed(details.url)) return callback({ cancel: true })
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'x-desktop-transport': config.transportKey,
        'x-desktop-broker': config.brokerToken
      }
    })
  })
  let grant = null,
    pending,
    controller,
    closing = false
  const vault = new CredentialVault({
    safeStorage,
    directory: join(config.state, 'game-vault'),
    consent: () => grant !== null
  })
  const broker = new OfficialRaidBroker({ vault, consent: () => grant })
  const request = async (path, body) => {
    if (!operations.has(path)) throw new Error('Unsupported operation')
    const response = await coordinator.fetch(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(10000)
    })
    if (!response.ok) throw new Error('Local operation refused')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Invalid local result')
    const parts = []
    let size = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 16384) throw new Error('Invalid local result')
        parts.push(part.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  }
  const publish = () => {
    const status = broker.status()
    return request(
      '/desktop/broker-status',
      status.connected
        ? { ...status, installation: grant.installation }
        : { connected: false }
    )
  }
  const refresh = () => {
    const menu = Menu.getApplicationMenu()
    const connected = broker.status().connected
    const connect = menu?.getMenuItemById('game-connect'),
      sync = menu?.getMenuItemById('game-sync'),
      disconnect = menu?.getMenuItemById('game-disconnect')
    if (connect) connect.enabled = !pending && !connected
    if (sync) sync.enabled = !pending && connected
    if (disconnect) disconnect.enabled = true
  }
  const context = async () => {
    let password = await nativeSecretPrompt('workspace-password', {
      signal: controller.signal
    })
    try {
      return {
        context: await request('/desktop/broker-context', { password }),
        password
      }
    } catch {
      password = ''
      throw new Error('Workspace confirmation failed')
    }
  }
  const run = (operation) => {
    if (pending || closing) return
    const hadGrant = Boolean(grant)
    controller = new AbortController()
    pending = (async () => {
      try {
        await operation()
      } catch (error) {
        if (!broker.status().connected) {
          grant = null
          if (hadGrant) {
            try {
              await broker.disconnect()
              await forgetGameConnection(config.state)
            } catch {
              /* Keep its record available for explicit cleanup retry. */
            }
          }
        }
        if (error.code !== 'ECANCEL' && !controller.signal.aborted && !closing)
          await dialog.showMessageBox(window, {
            type: 'error',
            buttons: ['Close'],
            message:
              'The game operation could not complete. Check your workspace password, guild tag, key scopes and secure OS storage. Existing raid data was preserved.'
          })
      } finally {
        if (!closing) await publish().catch(() => {})
        pending = undefined
        controller = undefined
        refresh()
      }
    })()
    refresh()
    return pending
  }
  const connect = () =>
    run(async () => {
      const choice = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Connect your official Tacticus API key',
        message:
          'Connect only your own official API key with Player, Guild and Guild Raid scopes. The application will make read-only requests for your selected guild and store the key in secure OS storage, outside normal workspace backups. It does not discover game clients or verify your local player ID.',
        buttons: ['Cancel', 'Connect my key'],
        defaultId: 0,
        cancelId: 0
      })
      if (choice.response !== 1 || controller.signal.aborted) return
      const confirmed = await context()
      confirmed.password = ''
      grant = { ...confirmed.context, operation: 'official-guild-raids' }
      vault.ensureReady()
      const saved = await loadGameConnection(config.state)
      if (saved) await broker.resume(saved)
      else {
        let key = await nativeSecretPrompt('official-key', {
          signal: controller.signal
        })
        try {
          await broker.connect(key)
        } finally {
          key = ''
        }
      }
      try {
        await saveGameConnection(config.state, broker.savedConnection())
      } catch {
        await broker.disconnect()
        throw new Error('Connection persistence failed')
      }
      await publish()
      await dialog.showMessageBox(window, {
        type: 'info',
        buttons: ['Close'],
        message:
          'Official API connected for this guild. Use File → Game connection → Sync current raids. Players without a local name use a pseudonymous label; this connection does not verify ownership of your local player ID.'
      })
    })
  const sync = () =>
    run(async () => {
      const confirmed = await context()
      try {
        if (
          !grant ||
          confirmed.context.installation !== grant.installation ||
          confirmed.context.guildCode !== grant.guildCode
        ) {
          await broker.disconnect()
          throw new Error('Workspace changed')
        }
        const result = await broker.currentRaids()
        if (result.contents === null) {
          await dialog.showMessageBox(window, {
            type: 'info',
            buttons: ['Close'],
            message: 'There are no raid entries in the current season.'
          })
          return
        }
        const file = parseRaidFile(result.contents)
        const contents = JSON.stringify({
          format: 'ta-raid-file-v1',
          ...file,
          entries: file.entries.map((entry) => ({
            ...entry,
            username:
              entry.username ??
              'Unmapped player ' +
                createHash('sha256')
                  .update(file.guildCode + '\0' + entry.userId)
                  .digest('hex')
                  .slice(0, 16)
          }))
        })
        parseRaidFile(contents)
        const imported = await request('/desktop/import', {
          password: confirmed.password,
          contents
        })
        if (
          !Number.isInteger(imported.entries) ||
          !Number.isInteger(imported.inserted) ||
          imported.inserted < 0 ||
          imported.inserted > imported.entries ||
          imported.entries > 10000
        )
          throw new Error('Invalid import result')
        await saveGameConnection(config.state, broker.savedConnection())
        await dialog.showMessageBox(window, {
          type: 'info',
          buttons: ['Close'],
          message: `Saved ${imported.inserted} new raid records from ${imported.entries} entries. Existing records were preserved. Refresh the analytics page to view the current season.`
        })
      } finally {
        confirmed.password = ''
      }
    })
  const disconnect = async () => {
    controller?.abort()
    grant = null
    try {
      await broker.disconnect()
      const saved = await loadGameConnection(config.state)
      if (saved) await vault.forget(saved.handle)
      await forgetGameConnection(config.state)
    } catch {
      if (!closing)
        await dialog.showMessageBox(window, {
          type: 'error',
          buttons: ['Close'],
          message:
            'Game access was stopped, but the stored connection could not be completely removed. Check local storage permissions.'
        })
    }
    // A withdrawn operation must finish before publishing its disconnected state.
    await pending
    if (!closing) await publish().catch(() => {})
    refresh()
  }
  app.on('before-quit', (event) => {
    if (closing) return
    closing = true
    controller?.abort()
    grant = null
    broker.close()
    if (pending) {
      event.preventDefault()
      pending.finally(() => app.quit())
    }
  })
  return [
    {
      id: 'game-connect',
      label: 'Connect my official API key…',
      click: connect
    },
    {
      id: 'game-sync',
      label: 'Sync current raids…',
      enabled: false,
      click: sync
    },
    {
      id: 'game-disconnect',
      label: 'Disconnect and remove key',
      click: disconnect
    }
  ]
}
