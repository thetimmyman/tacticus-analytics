import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// The ratchet fails closed on an untrustworthy `tsc` run, which otherwise parses as zero errors.
const SCRIPT = path.resolve(
  __dirname,
  '../../../scripts/validation/check-test-typecheck-ratchet.mjs'
)

const tempDirs: string[] = []

function makeOutputFile(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ts-ratchet-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'tsc-output.txt')
  writeFileSync(file, contents)
  return file
}

function runCheck(contents: string): { status: number; output: string } {
  const file = makeOutputFile(contents)
  try {
    const output = execFileSync(
      process.execPath,
      [SCRIPT, '--check', '--from', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return { status: 0, output }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: err.status ?? -1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
  }
}

/** Runs a copy of the script in a temp root holding only the two lockfiles (null = no hidden lockfile). */
function runInstallCheck(
  lockedVersion: string,
  installedVersion: string | null
): { status: number; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'ts-ratchet-root-'))
  tempDirs.push(root)
  mkdirSync(path.join(root, 'scripts', 'validation'), { recursive: true })
  mkdirSync(path.join(root, 'node_modules'))
  const script = path.join(root, 'scripts', 'validation', path.basename(SCRIPT))
  copyFileSync(SCRIPT, script)
  const lockfile = (version: string) =>
    JSON.stringify({ packages: { 'node_modules/lib-a': { version } } })
  writeFileSync(path.join(root, 'package-lock.json'), lockfile(lockedVersion))
  if (installedVersion !== null) {
    writeFileSync(
      path.join(root, 'node_modules', '.package-lock.json'),
      lockfile(installedVersion)
    )
  }
  try {
    const output = execFileSync(process.execPath, [script, '--check'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { status: 0, output }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return {
      status: err.status ?? -1,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('check-test-typecheck-ratchet fails closed on unusable tsc runs', () => {
  it('rejects an unresolved type library (TS2688 with no file/line prefix)', () => {
    const result = runCheck(
      "error TS2688: Cannot find type definition file for 'node'.\n"
    )
    expect(result.status).toBe(1)
    expect(result.output).toContain('Failing closed')
    expect(result.output).toContain('TS2688')
    expect(result.output).not.toContain('ratchet OK')
  })

  it('rejects a broken project configuration (tsconfig diagnostic)', () => {
    const result = runCheck(
      'tsconfig.tests.json(5,7): error TS5023: Unknown compiler option.\n'
    )
    expect(result.status).toBe(1)
    expect(result.output).toContain('TS5023')
    expect(result.output).not.toContain('ratchet OK')
  })

  it('still passes on an ordinary diagnostic run below the baseline', () => {
    const result = runCheck(
      "tests/unit/a.test.ts(3,7): error TS6133: 'x' is declared but its value is never read.\nFound 1 error in 1 file.\n"
    )
    expect(result.status).toBe(0)
    expect(result.output).toContain('ratchet OK')
  })

  it('refuses to count over a node_modules that does not match package-lock.json', () => {
    const result = runInstallCheck('2.0.0', '1.9.0')
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'node_modules/lib-a: installed 1.9.0, locked 2.0.0'
    )
    expect(result.output).toContain('npm ci')
    expect(result.output).not.toContain('ratchet OK')
  })

  it('refuses to count when the install has no hidden lockfile to verify', () => {
    const result = runInstallCheck('2.0.0', null)
    expect(result.status).toBe(1)
    expect(result.output).toContain('.package-lock.json is missing')
    expect(result.output).not.toContain('ratchet OK')
  })

  it('selftest covers the fail-closed paths', () => {
    const output = execFileSync(process.execPath, [SCRIPT, '--selftest'], {
      encoding: 'utf8'
    })
    expect(output).toContain('selftest OK')
  })
})
