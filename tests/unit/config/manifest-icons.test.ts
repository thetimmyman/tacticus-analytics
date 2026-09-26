import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

// Manifest srcs must be git-tracked under public/ (untracked files are not shipped).

const repoRoot = path.resolve(__dirname, '../../..')
const manifestPath = path.join(repoRoot, 'public/manifest.json')

interface ManifestImage {
  src: string
  sizes?: string
  type?: string
  purpose?: string
  label?: string
}

interface Manifest {
  icons?: ManifestImage[]
  screenshots?: ManifestImage[]
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
}

function trackedPublicFiles(): Set<string> {
  const output = execFileSync('git', ['ls-files', 'public'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
  return new Set(output.split('\n').filter(Boolean))
}

function publicRelPath(src: string): string {
  return path.posix.join('public', src.replace(/^\//, ''))
}

function untrackedEntries(images: ManifestImage[], tracked: Set<string>) {
  return images.filter((image) => !tracked.has(publicRelPath(image.src)))
}

describe('public/manifest.json icons', () => {
  const manifest = readManifest()
  const icons = manifest.icons ?? []
  const tracked = trackedPublicFiles()

  it('has at least one icon entry', () => {
    expect(icons.length).toBeGreaterThan(0)
  })

  it('every icons[].src resolves to a file tracked under public/', () => {
    expect(untrackedEntries(icons, tracked)).toEqual([])
  })

  it('includes a maskable icon with the standard 512x512 size', () => {
    const maskable = icons.find((icon) => icon.purpose === 'maskable')

    expect(maskable).toBeDefined()
    expect(maskable?.sizes).toBe('512x512')
  })

  it('every icon file’s actual pixel dimensions match its declared sizes', async () => {
    for (const icon of icons) {
      const [declaredWidth, declaredHeight] = (icon.sizes ?? '')
        .split('x')
        .map(Number)
      const filePath = path.join(repoRoot, publicRelPath(icon.src))
      const { width, height } = await sharp(filePath).metadata()

      expect(
        { src: icon.src, width, height },
        `${icon.src} should be ${icon.sizes}`
      ).toEqual({ src: icon.src, width: declaredWidth, height: declaredHeight })
    }
  })
})

describe('public/manifest.json screenshots', () => {
  const manifest = readManifest()
  const screenshots = manifest.screenshots ?? []
  const tracked = trackedPublicFiles()

  it('every screenshots[].src (if any) resolves to a file tracked under public/', () => {
    expect(untrackedEntries(screenshots, tracked)).toEqual([])
  })
})
