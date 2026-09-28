#!/usr/bin/env node
/** Generates the PWA manifest icons from public/favicon.svg (ImageMagick), glyph recoloured white. */
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const publicDir = path.join(repoRoot, 'public')
const iconsDir = path.join(publicDir, 'icons')
const svgSource = path.join(publicDir, 'favicon.svg')

const BACKGROUND_COLOR = '#000000'
const GLYPH_COLOR = '#ffffff'

mkdirSync(iconsDir, { recursive: true })

// mkdtempSync gives a private 0700 directory, not a symlink-attackable path.
const scratchDir = mkdtempSync(path.join(tmpdir(), 'pwa-icons-'))
const whiteSvgPath = path.join(scratchDir, 'favicon-white.svg')
const svgText = readFileSync(svgSource, 'utf8').replace(
  /fill="#000000"/g,
  `fill="${GLYPH_COLOR}"`
)
writeFileSync(whiteSvgPath, svgText)

function composite(outPath, canvasSize, glyphSize) {
  execFileSync('magick', [
    '-size',
    `${canvasSize}x${canvasSize}`,
    `xc:${BACKGROUND_COLOR}`,
    '(',
    '-background',
    'none',
    whiteSvgPath,
    '-resize',
    `${glyphSize}x${glyphSize}`,
    ')',
    '-gravity',
    'center',
    '-compose',
    'over',
    '-composite',
    // Drop PNG date chunks so re-runs are byte-identical.
    '-define',
    'png:exclude-chunk=date,time',
    outPath
  ])
  console.log(
    `wrote ${path.relative(repoRoot, outPath)} (${statSync(outPath).size} bytes)`
  )
}

for (const { file, size } of [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-1024.png', size: 1024 }
]) {
  composite(path.join(iconsDir, file), size, Math.round(size * 0.8))
}

// Maskable: glyph within the inner 80% safe zone so OS masks don't clip it.
composite(
  path.join(iconsDir, 'icon-512-maskable.png'),
  512,
  Math.round(512 * 0.8)
)

rmSync(scratchDir, { recursive: true, force: true })
