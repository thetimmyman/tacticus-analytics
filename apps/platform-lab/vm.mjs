import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { checkWorkspace, withWorkspaceLock } from './workspace.mjs'
import { runOwnedProcess } from './process.mjs'

/** QEMU snapshots are confined to an explicitly disposable lab image. */
export async function disposableVmImage(
  workspace,
  operation,
  snapshot = 'baseline'
) {
  await checkWorkspace(workspace)
  if (
    !['create-empty', 'snapshot', 'restore', 'list'].includes(operation) ||
    !/^[a-z0-9-]{1,40}$/.test(snapshot)
  )
    throw new Error('Invalid disposable image operation')
  return withWorkspaceLock(workspace, async () => {
    const image = join(workspace, 'state', 'guest.qcow2')
    if (operation === 'create-empty') {
      try {
        await access(image)
        throw new Error('Existing image will not be replaced')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    } else await access(image)
    const args =
      operation === 'create-empty'
        ? ['create', '-f', 'qcow2', image, '64M']
        : [
            'snapshot',
            operation === 'snapshot'
              ? '-c'
              : operation === 'restore'
                ? '-a'
                : '-l',
            ...(operation === 'list' ? [] : [snapshot]),
            image
          ]
    const result = await runOwnedProcess('qemu-img', args, { timeoutMs: 30000 })
    if (result.code !== 0 || result.timedOut || result.exceeded)
      throw new Error('Disposable QEMU image operation failed')
    return { operation, imageFormat: 'qcow2', snapshot, status: 'pass' }
  })
}
