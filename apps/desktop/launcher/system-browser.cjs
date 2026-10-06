const { spawn } = require('node:child_process')
const { openSync, closeSync } = require('node:fs')
const { externalWebsiteUrl } = require('./external-links.cjs')

function browserEnvironment(env) {
  const allowed = [
    'HOME',
    'LANG',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XAUTHORITY',
    'XDG_RUNTIME_DIR',
    'XDG_CURRENT_DESKTOP',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'DBUS_SESSION_BUS_ADDRESS'
  ]
  return {
    ...Object.fromEntries(
      allowed.filter((key) => env[key]).map((key) => [key, env[key]])
    ),
    PATH: '/usr/bin:/bin'
  }
}

function openSystemBrowser(
  value,
  {
    platform = process.platform,
    env = process.env,
    spawnProcess = spawn,
    electronShell,
    settleMs = 500
  } = {}
) {
  const url = externalWebsiteUrl(value, '')
  if (!url) return Promise.reject(new Error('Invalid website URL'))
  if (platform !== 'linux')
    return (electronShell || require('electron').shell).openExternal(url)
  return new Promise((resolve, reject) => {
    const nullDescriptor = openSync('/dev/null', 'r')
    let child
    try {
      child = spawnProcess('/usr/bin/xdg-open', [url], {
        env: browserEnvironment(env),
        detached: true,
        // Replace native IPC/lease descriptors in the child, retaining the owner's lease.
        stdio: ['ignore', 'ignore', 'ignore', nullDescriptor, nullDescriptor]
      })
    } finally {
      closeSync(nullDescriptor)
    }
    let timer
    const finish = (error) => {
      clearTimeout(timer)
      if (error) reject(new Error('System browser could not be opened'))
      else resolve()
    }
    child.once('error', finish)
    child.once('exit', (code) => finish(code !== 0))
    child.once('spawn', () => {
      child.unref()
      timer = setTimeout(() => finish(false), settleMs)
      timer.unref()
    })
  })
}

module.exports = { browserEnvironment, openSystemBrowser }
