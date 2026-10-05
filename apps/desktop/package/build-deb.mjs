import { cp, mkdir, writeFile, stat } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
const [bundle, output] = process.argv.slice(2)
if (!isAbsolute(bundle || '') || !isAbsolute(output || ''))
  throw new Error('Absolute bundle and new output-directory paths are required')
try {
  await stat(output)
  throw new Error('Output already exists')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await mkdir(output, { recursive: true, mode: 0o700 })
const image =
  'ubuntu@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02'
const root = join(output, 'payload')
await cp(bundle, join(root, 'opt/tacticus-analytics-preview'), {
  recursive: true
})
await mkdir(join(root, 'DEBIAN'), { recursive: true })
await mkdir(join(root, 'usr/share/applications'), { recursive: true })
await writeFile(
  join(root, 'DEBIAN/control'),
  `Package: tacticus-analytics-preview\nVersion: 0.0.0-preview1\nArchitecture: amd64\nMaintainer: Tacticus Analytics\nSection: games\nPriority: optional\nDepends: libc6 (>= 2.35), libstdc++6, libgtk-3-0, libnss3, libasound2, libgbm1, libxss1, libdrm2, libatk1.0-0, libatk-bridge2.0-0, libx11-6, libxcb1, libxkbcommon0, xkb-data, fonts-dejavu-core, libsecret-1-0, zenity, xdg-utils\nDescription: Private Tacticus Analytics desktop preview\n Local accounts, sample data, raid-file imports and manual official API sync.\n Automatic game connection and complete desktop feature parity are not included.\n`
)
await writeFile(
  join(root, 'usr/share/applications/tacticus-analytics-preview.desktop'),
  `[Desktop Entry]\nType=Application\nName=Tacticus Analytics Preview\nComment=Local raid analytics preview\nExec=/opt/tacticus-analytics-preview/launch\nIcon=/opt/tacticus-analytics-preview/application/public/favicon.svg\nTerminal=false\nCategories=Game;Utility;\n`
)
// Packaging runs in a disposable builder. Consumers install with their ordinary
// graphical package manager; no Docker or Node installation is required.
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${output}:/output`,
    image,
    'sh',
    '-c',
    'chmod -R a+rX /output/payload; dpkg-deb --root-owner-group -Zgzip --build /output/payload /output/tacticus-analytics-preview_0.0.0-preview1_amd64.deb'
  ],
  { stdio: 'inherit' }
)
if (result.status !== 0) throw new Error('Debian package builder failed')
