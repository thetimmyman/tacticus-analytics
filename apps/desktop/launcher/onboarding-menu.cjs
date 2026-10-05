const { join } = require('node:path')
const { createHash } = require('node:crypto')

module.exports = async function onboardingMenu(
  window,
  config,
  dependencies = {}
) {
  const { app, dialog, safeStorage } =
    dependencies.electron ?? require('electron')
  const { CredentialVault } = await import('./credential-vault.mjs')
  const { verifyOfficialAccess } = await import('./official-access.mjs')
  const { loadScopedConnections, saveScopedConnections } =
    await import('./scoped-connections.mjs')
  const prompt =
    dependencies.nativeSecretPrompt ??
    (await import('./native-secret.mjs')).nativeSecretPrompt
  const request = dependencies.fetch ?? globalThis.fetch
  const origin = new URL(config.url).origin
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    ![config.transportKey, config.brokerToken].every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    )
  )
    throw new Error('Invalid native onboarding destination')
  let grant = null,
    pending,
    controller,
    closing = false
  const vault = new CredentialVault({
    safeStorage,
    directory: join(config.state, 'game-vault'),
    consent: () => grant !== null
  })
  const local = async (path, body) => {
    if (
      ![
        '/desktop/broker-context',
        '/desktop/import-player',
        '/desktop/import'
      ].includes(path)
    )
      throw new Error('Unsupported local operation')
    const response = await request(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-desktop-transport': config.transportKey,
        'x-desktop-broker': config.brokerToken,
        origin
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
    })
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== origin + path)
    )
      throw new Error('Local workspace operation failed')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Invalid local result')
    let bytes = 0
    const parts = []
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.length
        if (bytes > 16384) throw new Error('Invalid local result')
        parts.push(part.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  }
  const connect = (scope) => {
    if (
      pending ||
      closing ||
      !['Player', 'Guild', 'Guild Raid', 'Disconnect'].includes(scope)
    )
      return
    controller = new AbortController()
    pending = (async () => {
      let password = '',
        handle,
        newHandle = false
      try {
        const consent = await dialog.showMessageBox(window, {
          type: 'question',
          title:
            scope === 'Disconnect'
              ? 'Remove saved API keys'
              : `Connect ${scope} API access`,
          message:
            scope === 'Disconnect'
              ? 'Remove all saved official API keys from this device? Your workspace and previously synced data remain available offline. You can connect keys again later.'
              : `Use your official ${scope} API key for read-only requests to Snowprint. The key stays in this device's secure OS vault and is excluded from workspace backups and exports. This does not enable cloud contribution. Guild Raid access also needs Guild scope to verify the selected guild.`,
          buttons: ['Cancel', 'Continue'],
          defaultId: 0,
          cancelId: 0
        })
        if (consent.response !== 1 || controller.signal.aborted) return
        password = await prompt('workspace-password', {
          signal: controller.signal
        })
        const context = await local('/desktop/broker-context', { password })
        if (
          !context ||
          typeof context.installation !== 'string' ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
            context.installation
          ) ||
          typeof context.guildCode !== 'string' ||
          !/^[A-Za-z0-9_-]{1,32}$/.test(context.guildCode)
        )
          throw new Error('Invalid workspace context')
        grant = context
        vault.ensureReady()
        const previous = await loadScopedConnections(config.state)
        if (
          previous &&
          (previous.installation !== context.installation ||
            previous.guildCode !== context.guildCode)
        )
          throw new Error('The workspace changed')
        const record = previous ?? {
          format: 'ta-scoped-official-access-v1',
          ...context,
          roles: {}
        }
        if (scope === 'Disconnect') {
          for (const savedHandle of new Set(
            Object.values(record.roles).map((role) => role.handle)
          )) {
            controller.signal.throwIfAborted()
            await vault.forget(savedHandle)
          }
          record.roles = {}
          await saveScopedConnections(config.state, record)
          await dialog.showMessageBox(window, {
            type: 'info',
            message:
              'Saved API keys removed. Previously synced data is retained for offline use.',
            buttons: ['Close']
          })
          if (!closing) await window.loadURL(origin + '/desktop/connect')
          return
        }
        if (scope !== 'Player' && !record.roles.Player)
          throw new Error('Connect Player access first')
        const saved = record.roles[scope] ?? record.roles.Player
        let data
        if (saved) {
          const choice = await dialog.showMessageBox(window, {
            type: 'question',
            message: `Use the saved key for ${scope} access, or enter another key? Its scope will be checked before use.`,
            buttons: ['Cancel', 'Use saved key', 'Enter another key'],
            defaultId: 0,
            cancelId: 0
          })
          if (choice.response === 0 || controller.signal.aborted) return
          if (choice.response === 1) {
            handle = saved.handle
            data = await vault.withCredential(handle, (key) =>
              verifyOfficialAccess(scope, key, context.guildCode, {
                fetch: request,
                signal: controller.signal
              })
            )
          }
        }
        if (!data) {
          let key = await prompt(
            {
              Player: 'player-api-key',
              Guild: 'guild-api-key',
              'Guild Raid': 'guild-raid-api-key'
            }[scope],
            { signal: controller.signal }
          )
          try {
            data = await verifyOfficialAccess(scope, key, context.guildCode, {
              fetch: request,
              signal: controller.signal
            })
            controller.signal.throwIfAborted()
            handle = await vault.save(key)
            newHandle = true
          } finally {
            key = ''
          }
        }
        controller.signal.throwIfAborted()
        if (scope === 'Player') {
          await local('/desktop/import-player', {
            password,
            contents: JSON.stringify({
              format: 'ta-official-roster-v1',
              guildCode: context.guildCode,
              ...data.roster
            }),
            resources: {
              tokens: data.tokens,
              bombs: data.bombs,
              upstreamUpdatedAt: data.upstreamUpdatedAt
            }
          })
        }
        if (
          scope === 'Guild Raid' &&
          record.roles.Guild &&
          data.guildId !== record.roles.Guild.guildId
        )
          throw new Error('Guild access does not match')
        if (scope === 'Guild Raid' && data.contents) {
          const file = JSON.parse(data.contents)
          file.entries = file.entries.map((entry) => ({
            ...entry,
            username:
              entry.username ??
              'Unmapped player ' +
                createHash('sha256')
                  .update(context.guildCode + '\0' + entry.userId)
                  .digest('hex')
                  .slice(0, 16)
          }))
          await local('/desktop/import', {
            password,
            contents: JSON.stringify(file)
          })
        }
        const old = record.roles[scope]?.handle
        record.roles[scope] = {
          handle,
          verifiedAt: Date.now(),
          expiresAt: data.expiresAt ?? null,
          ...(data.guildId ? { guildId: data.guildId } : {})
        }
        await saveScopedConnections(config.state, record)
        newHandle = false
        if (
          old &&
          old !== handle &&
          !Object.values(record.roles).some((value) => value.handle === old)
        )
          await vault.forget(old)
        await dialog.showMessageBox(window, {
          type: 'info',
          message:
            scope === 'Player'
              ? 'Player access verified. Your roster and available token/bomb counters are saved for offline use. Guild and Guild Raid access can be added below.'
              : `${scope} access verified for the selected guild.`,
          buttons: ['Close']
        })
        if (!closing) await window.loadURL(origin + '/desktop/connect')
      } catch (error) {
        if (newHandle && handle) await vault.forget(handle).catch(() => {})
        if (!closing && error.code !== 'ECANCEL' && !controller.signal.aborted)
          await dialog.showMessageBox(window, {
            type: 'error',
            message:
              'API setup could not complete. Check your workspace password, key scopes, selected guild and secure OS storage. Existing local data was preserved.',
            buttons: ['Close']
          })
      } finally {
        password = ''
        grant = null
        controller = undefined
        pending = undefined
      }
    })()
    return pending
  }
  const actions = new Map([
    ['/desktop/connect-player', 'Player'],
    ['/desktop/connect-guild', 'Guild'],
    ['/desktop/connect-guild-raid', 'Guild Raid'],
    ['/desktop/disconnect-api-access', 'Disconnect']
  ])
  window.webContents.on('will-navigate', (event, address) => {
    const url = new URL(address)
    if (url.origin !== origin || !actions.has(url.pathname)) return
    event.preventDefault()
    if (
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      window.webContents.getURL() !== origin + '/desktop/connect'
    )
      return
    connect(actions.get(url.pathname))
  })
  app.on('before-quit', (event) => {
    if (closing) return
    closing = true
    controller?.abort()
    if (pending) {
      event.preventDefault()
      pending.finally(() => app.quit())
    }
  })
  return {
    id: 'workspace-api-access',
    label: 'Set up Player / Guild / Guild Raid access…',
    click: () => window.loadURL(origin + '/desktop/connect')
  }
}
