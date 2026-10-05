const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

module.exports = async function updateMenu(window, config, dependencies = {}) {
  const { dialog, app } = dependencies.electron ?? require('electron')
  const { checkForUpdate, downloadUpdate, updateConfiguration } =
    await import('./updates.mjs')
  let configuration
  try {
    configuration = updateConfiguration(
      JSON.parse(
        await readFile(join(__dirname, '../../../updates.json'), 'utf8')
      )
    )
  } catch {
    configuration = null
  }
  let pending,
    controller,
    closing = false
  const check = () => {
    if (pending || closing) return
    controller = new AbortController()
    pending = (async () => {
      try {
        if (!configuration || !configuration.manifestURL) {
          await dialog.showMessageBox(window, {
            type: 'info',
            message:
              'An update feed is not configured for this preview. Public downloads and release promotion remain pending.',
            buttons: ['Close']
          })
          return
        }
        const result = await checkForUpdate(configuration, {
          fetch: dependencies.fetch,
          signal: controller.signal
        })
        if (!result.update) {
          await dialog.showMessageBox(window, {
            type: 'info',
            message: `No newer verified update is available. Installed preview: ${configuration.version}.`,
            buttons: ['Close']
          })
          return
        }
        const update = result.update
        const choice = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'Verified preview update available',
          message: `Download Tacticus Analytics ${update.version}?\n\n${update.notes}\n\nThe signed manifest and package checksum are verified. Installation uses your OS package manager after you close the app; your workspace stays separate.`,
          buttons: ['Cancel', 'Download update'],
          defaultId: 0,
          cancelId: 0
        })
        if (choice.response !== 1 || controller.signal.aborted) return
        const selected = await dialog.showSaveDialog(window, {
          title: 'Save verified application update',
          defaultPath: `tacticus-analytics-preview-${update.version}${configuration.packageFormat === 'arch' ? '.pkg.tar.zst' : '.deb'}`
        })
        if (
          selected.canceled ||
          !selected.filePath ||
          controller.signal.aborted
        )
          return
        await downloadUpdate(configuration, update, selected.filePath, {
          fetch: dependencies.fetch,
          signal: controller.signal
        })
        if (!closing)
          await dialog.showMessageBox(window, {
            type: 'info',
            message: `Verified update saved to ${selected.filePath}. Close the app, then install this package with your OS package manager. Keep a workspace backup before upgrading. This preview does not install or restart automatically.`,
            buttons: ['Close']
          })
      } catch {
        if (!closing && !controller.signal.aborted)
          await dialog.showMessageBox(window, {
            type: 'error',
            message:
              'The update could not be downloaded and verified. Your installed app and workspace were preserved. Choose a new filename when retrying.',
            buttons: ['Close']
          })
      } finally {
        pending = undefined
        controller = undefined
      }
    })()
    return pending
  }
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
    id: 'application-check-updates',
    label: 'Check for application updates…',
    click: check
  }
}
