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
  highContrast: 'text-[var(--text-high-contrast)]',
  onPrimary: 'text-[var(--text-on-primary)]',
  onSecondary: 'text-[var(--text-on-secondary)]',
  onAccent: 'text-[var(--text-on-accent)]',
  onBackground: 'text-[var(--text-on-bg)]',

  dropdownText: 'text-[var(--text-primary)]',
  dropdownTextSecondary: 'text-[var(--text-secondary)]',
  dropdownBg: 'bg-[var(--dropdown-bg-solid)]',
  dropdownBorder: 'border-[var(--card-border)]',
  dropdownHover: 'hover:bg-[var(--hover-bg)]',

  btnTextPrimary: 'text-[var(--btn-text-primary)]',
  btnTextSecondary: 'text-[var(--btn-text-secondary)]'
}
