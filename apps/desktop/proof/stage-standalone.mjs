import { cp, mkdir, stat, readFile } from 'node:fs/promises'
import { dirname, resolve, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageApplicationNotices } from '../package/application-notices.mjs'
import { verifyDesktopBuild } from '../package/build-profile.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const destination = process.argv[2]
if (!destination || !isAbsolute(destination))
  throw new Error('An absolute staging destination is required')
const buildRecordPath = join(root, '.next/desktop-build.json')
verifyDesktopBuild(
  JSON.parse(await readFile(buildRecordPath, 'utf8')),
  await readFile(join(root, '.next/required-server-files.json'), 'utf8'),
  await readFile(join(root, '.next/BUILD_ID'), 'utf8')
)
try {
  await stat(destination)
  throw new Error('Staging destination already exists')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await mkdir(destination, { recursive: true, mode: 0o700 })
await cp(buildRecordPath, join(destination, 'desktop-build.json'))
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
const notices = await stageApplicationNotices({
  application: destination,
  sourceModules: join(root, 'node_modules')
})
console.log(
  JSON.stringify({
    applicationPackages: notices.packages.length,
    packagesRequiringNoticeReview: notices.packagesRequiringReview
  })
)
console.log('Standalone application staged with local assets')
