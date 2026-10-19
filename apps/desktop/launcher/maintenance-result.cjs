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
    if (status === 'selection-warning' || status === 'selection-uncertain') {
      const restoredSelected =
        status === 'selection-warning' && reason === 'selection-restored'
      const currentSelected =
        status === 'selection-warning' && reason === 'selection-current'
      const confirmed = restoredSelected || currentSelected
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Tacticus Analytics',
        message: confirmed
          ? restoredSelected
            ? 'Restored copy created and checked. The restored workspace is selected.'
            : 'Restored copy created and checked. Your current workspace is still selected.'
          : 'Restored copy created and checked. Workspace selection could not be confirmed.',
        detail:
          (confirmed
            ? 'A storage error occurred while saving which workspace should open next. This choice may not be retained after a restart. The confirmed workspace will open now. Check your storage and folder permissions before relying on the saved selection.'
            : 'A storage error prevented confirming which workspace is selected. The selection may already have changed. The app will close without opening a workspace. Check your storage and folder permissions before reopening it.') +
          `\n\nRestored copy:\n${directory}`,
        buttons: [
          confirmed
            ? restoredSelected
              ? 'Open restored workspace'
              : 'Return to workspace'
            : 'Close'
        ]
      })
      app.quit()
      return
    }
    const failed = status !== 'passed'
    const advice = {
      'passphrase-length':
        'Choose a longer backup passphrase, such as four or more words. Your current workspace will reopen so you can try again.',
      'passphrase-mismatch':
        'The two backup passphrases did not match. Your current workspace will reopen so you can try again.',
      'dialog-unavailable':
        'A secure workspace dialog could not open. Check that the system package zenity is installed, then try again. Your current workspace will reopen.'
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
