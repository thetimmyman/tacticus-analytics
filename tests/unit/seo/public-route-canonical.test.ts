import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPageMetadata } from '@/app/lib/metadata'

// Every public page must declare its own canonical path so no route
// collapses its canonical to the site root.
const PUBLIC_DIR = path.resolve(process.cwd(), 'app/(public)')

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return pageFiles(full)
    return entry.name === 'page.tsx' ? [full] : []
  })
}

function routeOf(file: string): string {
  const rel = path.relative(PUBLIC_DIR, file).replace(/\\/g, '/')
  return rel === 'page.tsx' ? '/' : `/${rel.replace(/\/page\.tsx$/u, '')}`
}

describe('public route metadata', () => {
  it('createPageMetadata emits the route canonical and og url', () => {
    const metadata = createPageMetadata({
      title: 'Explore Guilds',
      description: 'd',
      path: '/explore'
    })
    expect(metadata.alternates?.canonical).toBe('/explore')
    expect(metadata.openGraph?.url).toBe('/explore')
  })

  it('createPageMetadata keeps og/twitter images when set', () => {
    const metadata = createPageMetadata({
      title: 'Home',
      description: 'd',
      path: '/',
      image: '/WarpForgedDashboard.png'
    })
    expect(metadata.openGraph?.images).toEqual(['/WarpForgedDashboard.png'])
    expect(metadata.twitter?.images).toEqual(['/WarpForgedDashboard.png'])
  })

  it.each(pageFiles(PUBLIC_DIR).map((file) => [routeOf(file), file] as const))(
    '%s declares its own canonical',
    (route, file) => {
      const source = readFileSync(file, 'utf8')
      const viaHelper = source.includes(`path: '${route}'`)
      const viaAlternates = source.includes(`canonical: '${route}'`)
      expect(
        viaHelper || viaAlternates,
        `${file} must set alternates.canonical or createPageMetadata path`
      ).toBe(true)
    }
  )

  it('homepage keeps the site og image', () => {
    const source = readFileSync(path.join(PUBLIC_DIR, 'page.tsx'), 'utf8')
    expect(source).toContain('/WarpForgedDashboard.png')
  })
})
