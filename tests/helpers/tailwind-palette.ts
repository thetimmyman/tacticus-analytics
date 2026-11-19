import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const themeCss = readFileSync(
  createRequire(import.meta.url).resolve('tailwindcss/theme.css'),
  'utf8'
)

/** Tailwind palette entry (an oklch custom property) as an sRGB hex colour. */
export function palette(name: string): string {
  if (name === 'white') return '#ffffff'
  if (name === 'black') return '#000000'
  const match = new RegExp(`--color-${name}:\\s*oklch\\(([^)]+)\\)`, 'u').exec(
    themeCss
  )
  if (!match?.[1]) throw new Error(`no palette entry ${name}`)
  const [l = '', c = '', h = ''] = match[1].split(/\s+/u)
  const lightness = l.endsWith('%') ? parseFloat(l) / 100 : parseFloat(l)
  const hue = (parseFloat(h) * Math.PI) / 180
  const a = parseFloat(c) * Math.cos(hue)
  const b = parseFloat(c) * Math.sin(hue)
  const l3 = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  ]
  return (
    '#' +
    linear
      .map((v) => {
        const clamped = Math.min(1, Math.max(0, v))
        const encoded =
          clamped <= 0.0031308
            ? 12.92 * clamped
            : 1.055 * clamped ** (1 / 2.4) - 0.055
        return Math.round(encoded * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}
