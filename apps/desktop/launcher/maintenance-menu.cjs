const { Menu, dialog, app } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')

module.exports = function maintenanceMenu(window, config, gameItems = []) {
  let busy = false
  const request = async (operation, scripted) => {
    if (busy) return
    busy = true
    try {
      let source,
        directory,
        encrypted = true
      if (scripted) {
        source = scripted.source
        directory = scripted.directory
        encrypted = scripted.encrypted === true
      } else {
        const confirmed = await dialog.showMessageBox(window, {
          type: 'question',
          title:
            operation === 'backup'
              ? 'Back up your workspace'
              : 'Restore a workspace copy',
          message:
            operation === 'backup'
              ? 'The application will close to make a consistent encrypted backup. You will choose a separate backup passphrase. Keep it safely: the backup cannot be restored without it.'
              : 'Restore the account and data from a saved backup into a new workspace. Your current workspace will stay in place. The application will close during restore.',
          buttons: ['Cancel', 'Continue'],
          defaultId: 0,
          cancelId: 0
        })
        if (confirmed.response !== 1) return
        if (operation === 'restore') {
          const format = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Choose backup format',
            message: 'Choose the type of saved backup.',
            buttons: [
              'Cancel',
              'Encrypted backup file',
              'Legacy backup folder'
            ],
            defaultId: 1,
            cancelId: 0
          })
          if (format.response === 0) return
          encrypted = format.response === 1
          const picked = await dialog.showOpenDialog(window, {
            title: 'Choose a saved workspace backup',
            properties: [encrypted ? 'openFile' : 'openDirectory'],
            ...(encrypted
              ? {
                  filters: [
                    {
                      name: 'Encrypted workspace backup',
                      extensions: ['tabackup']
                    }
                  ]
                }
              : {})
          })
          if (picked.canceled) return
          source = picked.filePaths[0]
        }
        if (operation === 'backup') {
          const picked = await dialog.showSaveDialog(window, {
            title: 'Save encrypted workspace backup',
            defaultPath: `tacticus-backup-${new Date().toISOString().slice(0, 10)}.tabackup`,
            filters: [
              { name: 'Encrypted workspace backup', extensions: ['tabackup'] }
            ]
          })
          if (picked.canceled || !picked.filePath) return
          directory = picked.filePath
        } else {
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
      }
      writeFileSync(
        config.maintenanceRequest,
        JSON.stringify({
          nonce: config.maintenanceNonce,
          operation,
          directory,
          source,
          encrypted
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
          ...(gameItems.length
            ? [{ label: 'API access, add-ons and updates', submenu: gameItems }]
            : []),
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
