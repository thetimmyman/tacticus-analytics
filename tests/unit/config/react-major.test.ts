import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readJson = (file: string) =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), file), 'utf8'))

const major = (version: string) => Number(version.match(/\d+/)?.[0])

describe('React major versions', () => {
  it('keeps installed React packages, type packages, overrides, and lockfile aligned', () => {
    const react = readJson('node_modules/react/package.json')
    const reactDom = readJson('node_modules/react-dom/package.json')
    const reactTypes = readJson('node_modules/@types/react/package.json')
    const reactDomTypes = readJson('node_modules/@types/react-dom/package.json')
    const root = readJson('package.json')
    const lock = readJson('package-lock.json')
    const reactMajor = major(react.version)
    const typesMajor = major(reactTypes.version)
    const declaredTypesVersion =
      root.dependencies?.['@types/react'] ??
      root.devDependencies?.['@types/react']

    expect(reactDom.version).toBe(react.version)
    expect(reactMajor).toBeGreaterThanOrEqual(19)
    expect(major(reactDomTypes.version)).toBe(reactMajor)
    expect(typesMajor).toBe(reactMajor)
    expect(
      Object.keys(lock.packages).filter((entry) =>
        entry.endsWith('node_modules/@types/react')
      )
    ).toEqual(['node_modules/@types/react'])

    const checkOverrides = (overrides: Record<string, unknown>) => {
      for (const [name, value] of Object.entries(overrides)) {
        if (name === '@types/react' && typeof value === 'string') {
          expect(major(value.replace(/^[^\d]*/, ''))).toBe(
            major(declaredTypesVersion)
          )
        } else if (value && typeof value === 'object') {
          checkOverrides(value as Record<string, unknown>)
        }
      }
    }

    checkOverrides(root.overrides)
  })
})
