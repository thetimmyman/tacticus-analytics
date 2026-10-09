const { contextBridge, ipcRenderer } = require('electron')
const channel = process.argv
  .find((value) => /^--addon-channel=[a-f0-9]{64}$/.test(value))
  ?.slice(16)
if (!channel) throw new Error('Missing native add-on channel')
const commands = Object.fromEntries(
  [
    'list',
    'stagePackage',
    'activate',
    'setEnabled',
    'rollback',
    'uninstall',
    'importLocalData',
    'view',
    'exportLocalData'
  ].map((method) => [
    method,
    async (...args) => {
      const result = await ipcRenderer.invoke(channel, { method, args })
      if (!result.ok)
        throw Object.assign(new Error('Add-on action refused'), {
          code: result.code
        })
      return result.value
    }
  ])
)
contextBridge.exposeInMainWorld('localAddons', Object.freeze(commands))
