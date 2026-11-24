import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPageMetadata, DEFAULT_OG_IMAGE } from '@/app/lib/metadata'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/app/lib/auth', () => ({ getAuthUser: vi.fn() }))
vi.mock('@/app/lib/data/get-live-stats', () => ({ getLiveStats: vi.fn() }))
vi.mock('@/app/components/NavigationServer', () => ({
  NavigationServer: () => null
}))
vi.mock('@/app/components/homepage/LiveStatsSection', () => ({
  LiveStatsSection: () => null
}))
vi.mock('@/app/components/homepage/HeroCTA', () => ({ HeroCTA: () => null }))
vi.mock('@/app/components/homepage/FinalCTA', () => ({ FinalCTA: () => null }))
vi.mock('@/app/components/homepage/MarketingDeferredSections', () => ({
  MarketingDeferredSections: () => null
}))

import { metadata as homepageMetadata } from '@/app/(public)/page'

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
  it('createPageMetadata emits the route canonical, og url, and default og image', () => {
    const metadata = createPageMetadata({
      title: 'Explore Guilds',
      description: 'd',
      path: '/explore'
    })
    expect(metadata.alternates?.canonical).toBe('/explore')
    expect(metadata.openGraph?.url).toBe('/explore')
    expect(metadata.openGraph?.images).toEqual([DEFAULT_OG_IMAGE])
    expect(metadata.twitter?.images).toEqual([DEFAULT_OG_IMAGE.url])
  })

  it('createPageMetadata keeps custom og/twitter images when set', () => {
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

  it('homepage metadata explicitly includes openGraph.images and twitter.images', () => {
    expect(homepageMetadata.alternates?.canonical).toBe('/')
    expect(homepageMetadata.openGraph?.images).toEqual([
      {
        url: '/WarpForgedDashboard.png',
        width: 1536,
        height: 1024,
        alt: 'Tacticus Analytics'
      }
    ])
    expect(homepageMetadata.twitter?.images).toEqual([
      '/WarpForgedDashboard.png'
    ])
  })
})
