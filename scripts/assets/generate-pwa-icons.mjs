#!/usr/bin/env node
/** Derives app icons and compatibility logos without altering the SVG artwork. */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = path.join(root, 'public/favicon.svg')
const icons = path.join(root, 'public/icons')
const android = path.join(root, 'apps/mobile/android/app/src/main/res/drawable')
await mkdir(icons, { recursive: true })
await mkdir(android, { recursive: true })

async function raster(input, output, width) {
  await sharp(input, { density: 384 }).resize({ width }).png().toFile(output)
  console.log(`wrote ${path.relative(root, output)}`)
}

for (const size of [192, 512, 1024]) {
  await raster(source, path.join(icons, `icon-${size}.png`), size)
}
await raster(source, path.join(icons, 'apple-touch-icon.png'), 180)
await raster(source, path.join(android, 'app_icon.png'), 192)
await raster(source, path.join(root, 'public/images/logo-no-words.png'), 512)
await raster(
  path.join(root, 'public/brand/tacticus-analytics-logo.svg'),
  path.join(root, 'public/images/logo-words.png'),
  1024
)

// The entire tile fits in the central 80%-diameter safe circle, including corners.
// A 56% square has a diagonal below 80%; padding is outside the unchanged artwork.
const size = 512
const inset = await sharp(source, { density: 384 })
  .resize(Math.floor(size * 0.56))
  .png()
  .toBuffer()
await sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: '#0e1213'
  }
})
  .composite([{ input: inset, gravity: 'centre' }])
  .png()
  .toFile(path.join(icons, 'icon-512-maskable.png'))
console.log('wrote public/icons/icon-512-maskable.png')
