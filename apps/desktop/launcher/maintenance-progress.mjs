import { spawn as spawnProcess } from 'node:child_process'

const messages = {
  backup:
    'Saving your encrypted workspace backup. Your workspace will reopen when it is ready.',
  restore:
    'Restoring and checking your workspace copy. Your current workspace is being kept safely.'
}

export async function maintenanceProgress(
  operation,
  { spawn = spawnProcess } = {}
) {
  if (!Object.hasOwn(messages, operation))
    throw new Error('Invalid workspace operation')
  let child
  try {
    child = spawn(
      '/usr/bin/zenity',
      [
        '--progress',
        '--pulsate',
        '--no-cancel',
        '--auto-close',
        '--title',
        operation === 'backup' ? 'Backing up workspace' : 'Restoring workspace',
        '--text',
        messages[operation],
        '--width',
        '460'
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] }
    )
    child.stdin.on('error', () => {})
    const closed = new Promise((resolve) => child.once('close', resolve))
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    let finished = false
    return async () => {
      if (finished) return
      finished = true
      child.stdin.end('100\n')
      const terminate = setTimeout(() => child.kill('SIGTERM'), 500)
      const force = setTimeout(() => child.kill('SIGKILL'), 1500)
      try {
        await closed
      } finally {
        clearTimeout(terminate)
        clearTimeout(force)
      }
    }
  } catch {
    child?.kill('SIGKILL')
    throw Object.assign(
      new Error('The workspace progress dialog is unavailable.'),
      {
        code: 'ENATIVEDIALOG'
      }
    )
  }
}
