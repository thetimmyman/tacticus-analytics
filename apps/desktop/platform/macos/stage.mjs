import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  realpath,
  readlink,
  open
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  join,
  resolve,
  relative,
  isAbsolute,
  dirname,
  sep,
  basename
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
export async function containedLibrary(runtime, library) {
  // macOS exposes /var through /private/var. Compare both canonical paths so
  // a contained dependency stays valid through the OS alias and escaping links
  // still fail before install_name_tool modifies the executable.
  const root = await realpath(runtime),
    target = await realpath(library)
  const part = relative(root, target)
  if (part.startsWith('..') || isAbsolute(part))
    throw new Error('External relocated library target')
}
async function packageInventory(directory) {
  const files = [],
    directories = []
  const root = await realpath(directory)
  async function walk(path = '') {
    const entries = await readdir(join(root, path), { withFileTypes: true })
    for (const info of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const part = join(path, info.name),
        full = join(root, part)
      if (
        /(^|\/)(?:\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|credentials\.json|workspace-owner\.json|pgdata|\.git|\.claude)(?:\/|$)/u.test(
          part
        )
      )
        throw new Error('Mutable or private material in package')
      if (info.isDirectory()) {
        directories.push(part.split(sep).join('/'))
        await walk(part)
      } else if (info.isSymbolicLink()) {
        const target = await realpath(full)
        if (
          relative(root, target).startsWith('..') ||
          isAbsolute(relative(root, target))
        )
          throw new Error('External package symlink')
        files.push({
          path: part.split(sep).join('/'),
          link: await readlink(full)
        })
      } else {
        const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          if (!(await file.stat()).isFile())
            throw new Error('Package entry changed type')
          const bytes = await file.readFile()
          files.push({
            path: part.split(sep).join('/'),
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex')
          })
        } finally {
          await file.close()
        }
      }
    }
  }
  await walk()
  return { files, directories }
}
export async function inventory(directory) {
  return (await packageInventory(directory)).files
}
export async function stage(config) {
  if (
    !isAbsolute(config.output ?? '') ||
    !/^[a-f0-9]{40}$/u.test(config.sourceCommit ?? '') ||
    !['arm64', 'x64'].includes(config.architecture)
  )
    throw new Error(
      'Explicit source, architecture and absolute output required'
    )
  for (const key of [
    'application',
    'postgres',
    'node',
    'electron',
    'auth',
    'postgrest',
    'guard',
    'vault'
  ])
    if (!isAbsolute(config[key] ?? ''))
      throw new Error('Absolute native inputs required')
  await mkdir(config.output, { recursive: false, mode: 0o700 })
  const contents = join(config.output, 'Contents'),
    runtime = join(contents, 'Resources/runtime')
  await mkdir(join(contents, 'MacOS'), { recursive: true })
  await mkdir(runtime, { recursive: true })
  const copy = (from, to) =>
    cp(from, join(runtime, to), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true
    })
  await copy(config.application, 'application')
  await copy(config.postgres, 'postgres')
  await mkdir(join(runtime, 'bin'))
  await copy(config.node, 'bin/node')
  await copy(config.vault, 'bin/secret-vault')
  await copy(config.electron, 'electron')
  await copy(config.auth, 'auth')
  await mkdir(join(runtime, 'postgrest'))
  await copy(config.postgrest, 'postgrest/postgrest')
  for (const part of [
    'apps/desktop/launcher',
    'apps/desktop/proof',
    'apps/desktop/local-schema',
    'apps/desktop/platform/macos',
    'apps/platform-lab/contracts',
    'packages/workspace-onboarding',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ])
    await copy(join(source, part), part)
  await cp(config.guard, join(contents, 'MacOS/TacticusAnalytics'))
  await writeFile(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>TacticusAnalytics</string><key>CFBundleIdentifier</key><string>com.tacticusanalytics.desktop.preview</string><key>CFBundleName</key><string>Tacticus Analytics Preview</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>LSMinimumSystemVersion</key><string>15.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`
  )
  // Native library paths must resolve inside the bundle or OS system libraries.
  // Postgres build-prefix install names are relocated before the final inventory.
  if (process.platform === 'darwin') {
    for (const part of await inventory(config.output)) {
      if (part.link) continue
      const file = join(config.output, part.path),
        bytes = await readFile(file)
      if (
        bytes.length < 4 ||
        !['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca'].includes(
          bytes.subarray(0, 4).toString('hex')
        )
      )
        continue
      execFileSync('/usr/bin/lipo', [
        file,
        '-verify_arch',
        config.architecture === 'arm64' ? 'arm64' : 'x86_64'
      ])
      // Electron helper names contain parentheses. Disable otool's archive
      // member filename syntax so the exact bundled executable is inspected.
      const libraries = execFileSync('/usr/bin/otool', ['-m', '-L', file], {
        encoding: 'utf8'
      })
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(' (')[0])
        .filter(Boolean)
      let relocated = false
      for (const library of libraries) {
        let bundled
        if (library.startsWith(config.postgres + '/lib/')) {
          bundled = join(
            runtime,
            'postgres/lib',
            library.slice((config.postgres + '/lib/').length)
          )
        } else if (
          file === join(runtime, 'postgrest/postgrest') &&
          [
            '/opt/homebrew/opt/libpq/lib/libpq.5.dylib',
            '/usr/local/opt/libpq/lib/libpq.5.dylib'
          ].includes(library)
        ) {
          // The pinned official PostgREST archives name the stable libpq.5 ABI
          // at a builder prefix. Use the owned, inventoried PostgreSQL library.
          bundled = join(runtime, 'postgres/lib/libpq.5.dylib')
        }
        if (bundled) {
          await containedLibrary(runtime, bundled)
          const replacement = relative(dirname(file), bundled)
          execFileSync('/usr/bin/install_name_tool', [
            '-change',
            library,
            `@loader_path/${replacement}`,
            file
          ])
          relocated = true
        } else if (
          !library.startsWith('/usr/lib/') &&
          !library.startsWith('/System/Library/') &&
          !library.startsWith('@')
        ) {
          throw new Error(
            `Undeclared external Mach-O dependency: ${part.path} -> ${basename(library)}`
          )
        }
      }
      if (relocated) {
        if (file.endsWith('.dylib'))
          execFileSync('/usr/bin/install_name_tool', [
            '-id',
            `@rpath/${part.path.split('/').at(-1)}`,
            file
          ])
        // A local ad-hoc loader seal preserves arm64 Mach-O integrity after
        // relocation. It creates no signing identity or trusted release signature.
        execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', file])
      }
    }
  }
  const { files, directories } = await packageInventory(config.output)
  const manifest = {
    schemaVersion: 2,
    platform: 'macos',
    architecture: config.architecture,
    sourceCommit: config.sourceCommit,
    kind: 'unsigned-developer-candidate',
    rights: 'review-required',
    minimumOS: '15.0',
    files,
    directories
  }
  await writeFile(
    join(contents, 'Resources/package-inventory.json'),
    JSON.stringify(manifest, null, 2)
  )
  return {
    files: files.length,
    inventorySha256: createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex')
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      await stage(JSON.parse(await readFile(process.argv[2], 'utf8')))
    )
  )
}
