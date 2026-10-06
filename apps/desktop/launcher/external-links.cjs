function externalWebsiteUrl(value, origin) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\s\\\u0000-\u001f\u007f]/.test(value)
  )
    return null
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin === origin
    )
      return null
    return url.href
  } catch {
    return null
  }
}

function installExternalLinks(
  window,
  origin,
  { dialog, shell, enabled = true }
) {
  let busy = false
  const localPage = () => {
    if (window.isDestroyed()) return false
    try {
      return new URL(window.webContents.getURL()).origin === origin
    } catch {
      return false
    }
  }
  const open = async (value) => {
    const url = externalWebsiteUrl(value, origin)
    if (!enabled || !url || busy || !localPage()) return
    busy = true
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Open website in your browser',
        message: 'Open this website in your default browser?',
        detail: url,
        buttons: ['Cancel', 'Open website'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (result.response === 1 && localPage()) await shell.openExternal(url)
    } catch {
      if (localPage())
        await dialog
          .showMessageBox(window, {
            type: 'error',
            message:
              'Your browser could not be opened. Copy the link and open it in your browser.',
            buttons: ['Close']
          })
          .catch(() => {})
    } finally {
      busy = false
    }
  }
  window.webContents.setWindowOpenHandler((details) => {
    if (!details.postBody) void open(details.url)
    return { action: 'deny' }
  })
  const isLocal = (value) => {
    try {
      return new URL(value).origin === origin
    } catch {
      return false
    }
  }
  window.webContents.on('will-navigate', (event, value) => {
    const url = event.url || value
    if (!isLocal(url)) {
      event.preventDefault()
      void open(url)
    }
  })
  window.webContents.on('will-redirect', (event, value) => {
    if (!isLocal(event.url || value)) event.preventDefault()
  })
}

module.exports = { externalWebsiteUrl, installExternalLinks }
