function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  hex = hex.replace('#', '')

  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) {
    return null
  }
  const r = result[1]
  const g = result[2]
  const b = result[3]
  if (!r || !g || !b) {
    return null
  }
  return {
    r: parseInt(r, 16),
    g: parseInt(g, 16),
    b: parseInt(b, 16)
  }
}

function getLuminance(r: number, g: number, b: number): number {
  const [rs = 0, gs = 0, bs = 0] = [r, g, b].map((c) => {
    const sRGB = c / 255
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

export function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)

  if (!rgb1 || !rgb2) return 1

  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b)
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b)

  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)

  return (lighter + 0.05) / (darker + 0.05)
}

export function meetsContrastStandard(
  ratio: number,
  level: 'AA' | 'AAA' = 'AA'
): boolean {
  const threshold = level === 'AAA' ? 7 : 4.5
  return ratio >= threshold
}

export function getHighContrastText(backgroundColor: string): string {
  const whiteContrast = getContrastRatio(backgroundColor, '#ffffff')
  const blackContrast = getContrastRatio(backgroundColor, '#000000')

  return whiteContrast > blackContrast ? '#ffffff' : '#000000'
}

export function getContrastAwareTextColor(backgroundColor: string): string {
  const primaryContrast = getHighContrastText(backgroundColor)

  if (primaryContrast === '#ffffff') {
    return 'rgba(255, 255, 255, 0.95)'
  } else {
    return 'rgba(0, 0, 0, 0.87)'
  }
}

/** Contrast the gradient label keeps on every colour along the gradient. */
const CTA_TARGET = 4.6
const CTA_SAMPLES = 32
const CTA_PULL_STEPS = 20

function mixHex(from: string, to: string, t: number): string | null {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  if (!a || !b) return null
  const channel = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`
}

/** Lowest contrast `label` has on any colour of the straight sRGB line. */
function lowestContrastAlong(label: string, from: string, to: string): number {
  let lowest = Infinity
  for (let i = 0; i <= CTA_SAMPLES; i++) {
    const colour = mixHex(from, to, i / CTA_SAMPLES)
    if (!colour) return 1
    lowest = Math.min(lowest, getContrastRatio(label, colour))
  }
  return lowest
}

/**
 * How far `other` has to move toward `anchor` before the anchor's best label
 * reads on the whole gradient (0 = not at all, 1 = a solid anchor colour).
 */
function pullToward(
  anchor: string,
  other: string
): { step: number; to: string; label: string } {
  const label = getHighContrastText(anchor)
  for (let step = 0; step < CTA_PULL_STEPS; step++) {
    const to = mixHex(other, anchor, step / CTA_PULL_STEPS)
    if (to && lowestContrastAlong(label, anchor, to) >= CTA_TARGET) {
      return { step, to: step === 0 ? other : to, label }
    }
  }
  // Solid anchor: the label already reads on it (4.58:1 at worst).
  return { step: CTA_PULL_STEPS, to: anchor, label }
}

/**
 * Stops and label for a primary-to-accent call-to-action. For 33 of 62 themes
 * no one label reads on both colours, so the label follows whichever needs the
 * smaller change and the other is pulled toward it only as far as needed (flat
 * when the colours agree). Paint it in sRGB (`bg-linear-to-r/srgb`).
 */
export function getCtaGradient(
  primary: string,
  accent: string
): { from: string; to: string; label: string } {
  const keepPrimary = pullToward(primary, accent)
  const keepAccent = pullToward(accent, primary)
  if (keepAccent.step < keepPrimary.step) {
    return { from: keepAccent.to, to: accent, label: keepAccent.label }
  }
  return { from: primary, to: keepPrimary.to, label: keepPrimary.label }
}

/** Share of the colour opposite the label mixed into a fill on hover. */
const HOVER_STEP = 0.14

/**
 * A control's fill while hovered: one step toward the colour opposite its
 * label, so hover is never the weaker state. A translucent tint cannot do
 * this, because it moves toward whatever sits behind it.
 */
export function getHoverFill(fill: string, label: string): string {
  const away = label === '#ffffff' ? '#000000' : '#ffffff'
  return mixHex(fill, away, HOVER_STEP) ?? fill
}

/**
 * Text colour for content on a filled primary, secondary or accent control.
 * Opaque black or white, whichever reads better: 62 of 62 theme fills reach
 * 4.5:1 this way, while a fixed white or black fails on about half of them.
 * The `--cta-*` trio is the same for a primary-to-accent gradient control, and
 * `--accent-fill-hover` is the accent fill's hover step.
 */
export function getOnFillVariables(fills: {
  primary: string
  secondary: string
  accent: string
}): Record<string, string> {
  const cta = getCtaGradient(fills.primary, fills.accent)
  const onAccent = getHighContrastText(fills.accent)
  return {
    '--on-primary': getHighContrastText(fills.primary),
    '--on-secondary': getHighContrastText(fills.secondary),
    '--on-accent': onAccent,
    '--accent-fill-hover': getHoverFill(fills.accent, onAccent),
    '--cta-from': cta.from,
    '--cta-to': cta.to,
    '--on-cta': cta.label
  }
}

/**
 * Label and hover fill for a filled danger or warning control, from the
 * colours the theme actually paints for them (Light Mode paints darker ones).
 * Only the signed-in runtime sets these; no pre-hydration surface shows one.
 */
export function getStatusFillVariables(fills: {
  danger: string
  warning: string
}): Record<string, string> {
  const onDanger = getHighContrastText(fills.danger)
  const onWarning = getHighContrastText(fills.warning)
  return {
    '--on-danger': onDanger,
    '--danger-fill-hover': getHoverFill(fills.danger, onDanger),
    '--on-warning': onWarning,
    '--warning-fill-hover': getHoverFill(fills.warning, onWarning)
  }
}

export function generateContrastVariables(theme: {
  cardBg: string
  primary: string
  secondary: string
  accent: string
  background: { from: string; to: string; via?: string }
}): Record<string, string> {
  const variables: Record<string, string> = {}

  variables['--text-high-contrast'] = getContrastAwareTextColor(theme.cardBg)
  variables['--text-on-primary'] = getContrastAwareTextColor(theme.primary)
  variables['--text-on-secondary'] = getContrastAwareTextColor(theme.secondary)
  variables['--text-on-accent'] = getContrastAwareTextColor(theme.accent)
  variables['--text-on-bg'] = getContrastAwareTextColor(theme.background.from)

  const dropdownBg = 'rgba(15, 23, 42, 0.98)' // Very dark with high opacity
  variables['--dropdown-bg'] = dropdownBg
  variables['--dropdown-text'] = 'rgba(255, 255, 255, 0.95)'
  variables['--dropdown-text-secondary'] = 'rgba(255, 255, 255, 0.7)'
  variables['--dropdown-border'] = 'rgba(148, 163, 184, 0.3)'
  variables['--dropdown-hover'] = 'rgba(255, 255, 255, 0.1)'

  variables['--btn-text-primary'] = getContrastAwareTextColor(theme.primary)
  variables['--btn-text-secondary'] = getContrastAwareTextColor(theme.secondary)

  return variables
}

export const contrastClasses = {
  highContrast: 'text-(--text-high-contrast)',
  onPrimary: 'text-(--text-on-primary)',
  onSecondary: 'text-(--text-on-secondary)',
  onAccent: 'text-(--text-on-accent)',
  onBackground: 'text-(--text-on-bg)',

  dropdownText: 'text-primary-wh40k',
  dropdownTextSecondary: 'text-secondary-wh40k',
  dropdownBg: 'bg-(--dropdown-bg-solid)',
  dropdownBorder: 'border-(--card-border)',
  dropdownHover: 'hover:bg-(--hover-bg)',

  btnTextPrimary: 'text-(--btn-text-primary)',
  btnTextSecondary: 'text-(--btn-text-secondary)'
}
