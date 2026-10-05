const { join } = require('node:path')
const { randomBytes, createHash } = require('node:crypto')

module.exports = async function onboardingMenu(
  window,
  config,
  dependencies = {}
) {
  const { app, dialog, safeStorage } =
    dependencies.electron ?? require('electron')
  const { currentWorkspaceToken } = await import('./workspace-session.mjs')
  const { CredentialVault } = await import('./credential-vault.mjs')
  const { verifyOfficialAccess } = await import('./official-access.mjs')
  const { loadScopedConnections, saveScopedConnections } =
    await import('./scoped-connections.mjs')
  const prompt =
    dependencies.nativeSecretPrompt ??
    (await import('./native-secret.mjs')).nativeSecretPrompt
  const request =
    dependencies.officialFetch ?? dependencies.fetch ?? globalThis.fetch
  const origin = new URL(config.url).origin
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    ![config.transportKey, config.brokerToken].every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    )
  )
    throw new Error('Invalid native onboarding destination')
  const operations = new Set([
    '/desktop/broker-context',
    '/desktop/import-player',
    '/desktop/import'
  ])
  const coordinator = dependencies.fetch
    ? null
    : require('electron').session.fromPartition(
        'native-api-' + randomBytes(16).toString('hex')
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
  coordinator?.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowed(details.url) })
  )
  coordinator?.webRequest.onBeforeSendHeaders((details, callback) =>
    callback(
      allowed(details.url)
        ? {
            requestHeaders: {
              ...details.requestHeaders,
              'x-desktop-transport': config.transportKey,
              'x-desktop-broker': config.brokerToken
            }
          }
        : { cancel: true }
    )
  )
  let sessionToken = ''
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
    const response = await (
      dependencies.fetch ?? coordinator.fetch.bind(coordinator)
    )(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionToken}`,

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
      throw Object.assign(new Error('Local workspace operation failed'), {
        code:
          response.status === 401
            ? 'ESESSION'
            : response.status === 429
              ? 'ERETRY'
              : path === '/desktop/import-player' || path === '/desktop/import'
                ? 'EIMPORT'
                : 'ELOCAL'
      })
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
      let handle,
        newHandle = false
      try {
        if (scope === 'Disconnect') {
          const consent = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Remove saved API keys',
            message:
              'Remove all saved API keys from this device? Your cached data is retained.',
            buttons: ['Cancel', 'Remove keys'],
            defaultId: 0,
            cancelId: 0
          })
          if (consent.response !== 1 || controller.signal.aborted) return
        }
        sessionToken = currentWorkspaceToken(
          await window.webContents.session.cookies.get({ url: origin })
        )
        const context = await local('/desktop/broker-context', {})
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
        const messages = {
          EGUILDMISMATCH:
            'This key belongs to a different guild than the workspace. Use the matching guild key or correct the workspace guild.',
          EOPERATION:
            'The saved key could not complete this API request. Try another key or try again later.',
          EKEYFORMAT:
            'Enter the API key exactly as generated by Tacticus (including its hyphens).',
          EUPSTREAMAUTH:
            'Tacticus rejected this key or its access scope. Check that the key is active and grants the selected access.',
          EUPSTREAMRATE:
            'Tacticus is limiting API requests. Wait before trying again.',
          EUPSTREAMSERVICE:
            'The Tacticus API is temporarily unavailable. Try again later.',
          ENETWORK:
            'The app could not reach the Tacticus API. Check your connection and try again.',
          EUPSTREAMDATA:
            'Tacticus responded, but its access metadata or data format was not supported. Existing local data was preserved.',
          EROSTER:
            'Tacticus responded, but the app could not read this roster format. Existing local data was preserved.',
          EIMPORT:
            'API access was verified, but saving the data to your workspace failed. Existing local data was preserved.',
          ENATIVEDIALOG:
            'The secure key-entry dialog could not open. Try again.',
          ELOCAL:
            'The local workspace operation failed. Reopen the app and try again.'
        }
        if (newHandle && handle) await vault.forget(handle).catch(() => {})
        if (!closing && error.code !== 'ECANCEL' && !controller.signal.aborted)
          await dialog.showMessageBox(window, {
            type: 'error',
            message:
              messages[error.code] ??
              (error.code === 'EVAULT'
                ? 'Your OS keyring is unavailable or locked. Unlock the system keyring and try again. Your key was not saved.'
                : error.code === 'ESESSION'
                  ? 'Your workspace session has expired. Unlock the workspace once, then try again.'
                  : error.code === 'ERETRY'
                    ? 'Please wait a few seconds, then try again.'
                    : 'The API key could not be verified. Check its Player/Guild scopes, the selected guild and your internet connection. Existing local data was preserved.'),
            buttons: ['Close']
          })
      } finally {
        sessionToken = ''
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
  window.webContents.on('did-navigate', (_event, address) => {
    if (address !== origin + '/desktop/connect') controller?.abort()
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
