const { Menu, dialog, app } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')

module.exports = function maintenanceMenu(window, config) {
  let busy = false
  const request = async (operation, scripted) => {
    if (busy) return
    busy = true
    try {
      let source, directory
      if (scripted) {
        source = scripted.source
        directory = scripted.directory
      } else {
        const confirmed = await dialog.showMessageBox(window, {
          type: 'question',
          title:
            operation === 'backup'
              ? 'Back up your workspace'
              : 'Restore a workspace copy',
          message:
            operation === 'backup'
              ? 'The application will close to make a consistent backup. The backup includes your local account and data; keep it private.'
              : 'Restore the account and data from a saved backup into a new workspace. Your current workspace will stay in place. The application will close during restore.',
          buttons: ['Cancel', 'Continue'],
          defaultId: 0,
          cancelId: 0
        })
        if (confirmed.response !== 1) return
        if (operation === 'restore') {
          const picked = await dialog.showOpenDialog(window, {
            title: 'Choose a saved workspace backup',
            properties: ['openDirectory']
          })
          if (picked.canceled) return
          source = picked.filePaths[0]
        }
        const parent = await dialog.showOpenDialog(window, {
          title:
            operation === 'backup'
              ? 'Choose where to save the backup'
              : 'Choose where to create the restored workspace',
          properties: ['openDirectory', 'createDirectory']
        })
        if (parent.canceled) return
        directory = join(
          parent.filePaths[0],
          `tacticus-${operation}-${new Date().toISOString().slice(0, 10)}-${randomUUID()}`
        )
      }
      writeFileSync(
        config.maintenanceRequest,
        JSON.stringify({
          nonce: config.maintenanceNonce,
          operation,
          directory,
          source
        }),
        { mode: 0o600, flag: 'wx' }
      )
      app.quit()
    } catch {
      await dialog.showMessageBox(window, {
        type: 'error',
        message:
          'The workspace operation could not be requested. Your existing data was preserved.',
        buttons: ['Close']
      })
    } finally {
      busy = false
    }
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            id: 'workspace-import',
            label: 'Import raid file…',
            click: () =>
              window.loadURL(new URL('/desktop/import', config.url).href)
          },
          {
            id: 'workspace-backup',
            label: 'Back up workspace…',
            click: () => request('backup')
          },
          {
            id: 'workspace-restore',
            label: 'Restore workspace from backup…',
            click: () => request('restore')
          },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
  return request
}
