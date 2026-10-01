import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const destination = process.argv[2]
if (!destination || !isAbsolute(destination))
  throw new Error('An absolute staging destination is required')
try {
  await stat(destination)
  throw new Error('Staging destination already exists')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await mkdir(destination, { recursive: true, mode: 0o700 })
await cp(join(root, '.next/standalone'), destination, {
  recursive: true,
  dereference: true
})
// Copy directory contents, never a nested static/static or public/public tree.
await cp(join(root, '.next/static'), join(destination, '.next/static'), {
  recursive: true,
  dereference: true
})
await cp(join(root, 'public'), join(destination, 'public'), {
  recursive: true,
  dereference: true
})
console.log('Standalone application staged with local assets')
