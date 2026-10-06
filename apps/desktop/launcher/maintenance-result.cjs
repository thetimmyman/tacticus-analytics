const { app, dialog } = require('electron')
const { join } = require('node:path')
const { homedir } = require('node:os')
app.enableSandbox()
app.setPath(
  'userData',
  join(homedir(), '.cache/tacticus-analytics-maintenance')
)
app
  .whenReady()
  .then(async () => {
    const [operation, directory] = process.argv.slice(2)
    await dialog.showMessageBox({
      type: 'info',
      title: 'Tacticus Analytics',
      message:
        operation === 'backup'
          ? 'Workspace backup saved.'
          : 'Workspace restored. Open Tacticus Analytics to use the restored copy.',
      detail: directory,
      buttons: ['Close']
    })
    app.quit()
  })
  .catch(() => app.exit(1))
