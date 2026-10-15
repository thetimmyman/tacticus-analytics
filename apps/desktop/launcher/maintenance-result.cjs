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
    const [operation, status, directory, reason] = process.argv.slice(2)
    const failed = status !== 'passed'
    const advice = {
      'passphrase-length':
        'Choose a longer backup passphrase, such as four or more words. Your current workspace will reopen so you can try again.',
      'passphrase-mismatch':
        'The two backup passphrases did not match. Your current workspace will reopen so you can try again.',
      'dialog-unavailable':
        'The secure passphrase dialog could not open. Check that the system package zenity is installed, then try again. Your current workspace will reopen.'
    }
    await dialog.showMessageBox({
      type: failed ? 'error' : 'info',
      title: 'Tacticus Analytics',
      message: failed
        ? operation === 'backup'
          ? 'The backup could not be saved. Your workspace was preserved.'
          : 'The backup could not be restored. Your current workspace was preserved.'
        : operation === 'backup'
          ? 'Workspace backup saved.'
          : 'Workspace restored. The restored copy will open next.',
      detail: failed
        ? (advice[reason] ??
          'Check the backup passphrase, available storage and folder permissions, then try again. Any incomplete copy has been retained. Your current workspace will reopen.')
        : directory,
      buttons: [
        failed || operation === 'backup'
          ? 'Return to workspace'
          : 'Open restored workspace'
      ]
    })
    app.quit()
  })
  .catch(() => app.exit(1))
