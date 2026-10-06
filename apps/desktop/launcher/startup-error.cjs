const { app, dialog } = require('electron')
const { join } = require('node:path')
const { homedir } = require('node:os')
app.enableSandbox()
app.setPath('userData', join(homedir(), '.cache/tacticus-analytics-startup'))
app
  .whenReady()
  .then(async () => {
    const { startupMessage } = await import('./startup-message.mjs')
    await dialog.showMessageBox({
      type: 'error',
      title: 'Tacticus Analytics could not start',
      message: startupMessage(process.argv[2]),
      buttons: ['Close']
    })
    app.quit()
  })
  .catch(() => app.exit(1))
