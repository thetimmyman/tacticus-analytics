import { describe, it, expect } from 'vitest'
import {
  getContrastRatio,
  meetsContrastStandard,
  getHighContrastText,
  getContrastAwareTextColor,
  generateContrastVariables,
  contrastClasses
} from '@/app/lib/utils/contrast'

describe('Contrast Utilities', () => {
  describe('getContrastRatio', () => {
    it('returns 21 for black and white', () => {
      const ratio = getContrastRatio('#000000', '#ffffff')
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('returns 1 for identical colors', () => {
      expect(getContrastRatio('#ff0000', '#ff0000')).toBe(1)
      expect(getContrastRatio('#000000', '#000000')).toBe(1)
    })

    it('handles 3-digit hex codes', () => {
      const ratio = getContrastRatio('#000', '#fff')
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('handles hex codes without #', () => {
      const ratio = getContrastRatio('000000', 'ffffff')
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('returns 1 for invalid hex codes', () => {
      expect(getContrastRatio('invalid', '#ffffff')).toBe(1)
      expect(getContrastRatio('#ffffff', 'notahex')).toBe(1)
    })

    it('calculates intermediate contrast ratios', () => {
      const ratio = getContrastRatio('#777777', '#ffffff')
      expect(ratio).toBeGreaterThan(1)
      expect(ratio).toBeLessThan(21)
    })

    it('is symmetric', () => {
      const ratio1 = getContrastRatio('#ff0000', '#0000ff')
      const ratio2 = getContrastRatio('#0000ff', '#ff0000')
      expect(ratio1).toBeCloseTo(ratio2, 5)
    })
  })

  describe('meetsContrastStandard', () => {
    it('returns true for AA with ratio >= 4.5', () => {
      expect(meetsContrastStandard(4.5, 'AA')).toBe(true)
      expect(meetsContrastStandard(5, 'AA')).toBe(true)
      expect(meetsContrastStandard(21, 'AA')).toBe(true)
    })

    it('returns false for AA with ratio < 4.5', () => {
      expect(meetsContrastStandard(4.4, 'AA')).toBe(false)
      expect(meetsContrastStandard(3, 'AA')).toBe(false)
      expect(meetsContrastStandard(1, 'AA')).toBe(false)
    })

    it('returns true for AAA with ratio >= 7', () => {
      expect(meetsContrastStandard(7, 'AAA')).toBe(true)
      expect(meetsContrastStandard(10, 'AAA')).toBe(true)
      expect(meetsContrastStandard(21, 'AAA')).toBe(true)
    })

    it('returns false for AAA with ratio < 7', () => {
      expect(meetsContrastStandard(6.9, 'AAA')).toBe(false)
      expect(meetsContrastStandard(4.5, 'AAA')).toBe(false)
    })

    it('defaults to AA standard', () => {
      expect(meetsContrastStandard(4.5)).toBe(true)
      expect(meetsContrastStandard(4.4)).toBe(false)
    })
  })

  describe('getHighContrastText', () => {
    it('returns white for dark backgrounds', () => {
      expect(getHighContrastText('#000000')).toBe('#ffffff')
      expect(getHighContrastText('#1a1a1a')).toBe('#ffffff')
      expect(getHighContrastText('#333333')).toBe('#ffffff')
    })

    it('returns black for light backgrounds', () => {
      expect(getHighContrastText('#ffffff')).toBe('#000000')
      expect(getHighContrastText('#f0f0f0')).toBe('#000000')
      expect(getHighContrastText('#cccccc')).toBe('#000000')
    })

    it('handles colored backgrounds appropriately', () => {
      expect(getHighContrastText('#000080')).toBe('#ffffff')
      expect(getHighContrastText('#ffff00')).toBe('#000000')
    })
  })

  describe('getContrastAwareTextColor', () => {
    it('returns semi-transparent white for dark backgrounds', () => {
      const result = getContrastAwareTextColor('#000000')
      expect(result).toBe('rgba(255, 255, 255, 0.95)')
    })

    it('returns semi-transparent black for light backgrounds', () => {
      const result = getContrastAwareTextColor('#ffffff')
      expect(result).toBe('rgba(0, 0, 0, 0.87)')
    })
  })

  describe('generateContrastVariables', () => {
    it('generates all required CSS variables', () => {
      const theme = {
        cardBg: '#1e293b',
        primary: '#3b82f6',
        secondary: '#64748b',
        accent: '#f59e0b',
        background: { from: '#0f172a', to: '#1e293b' }
      }
      const variables = generateContrastVariables(theme)

      expect(variables['--text-high-contrast']).toBeDefined()
      expect(variables['--text-on-primary']).toBeDefined()
      expect(variables['--text-on-secondary']).toBeDefined()
      expect(variables['--text-on-accent']).toBeDefined()
      expect(variables['--text-on-bg']).toBeDefined()
      expect(variables['--dropdown-bg']).toBeDefined()
      expect(variables['--dropdown-text']).toBeDefined()
      expect(variables['--btn-text-primary']).toBeDefined()
    })

    it('generates appropriate text colors based on background', () => {
      const darkTheme = {
        cardBg: '#1e293b',
        primary: '#3b82f6',
        secondary: '#64748b',
        accent: '#f59e0b',
        background: { from: '#0f172a', to: '#1e293b' }
      }
      const variables = generateContrastVariables(darkTheme)

      expect(variables['--text-high-contrast']).toBe(
        'rgba(255, 255, 255, 0.95)'
      )
    })

    it('includes dropdown styling variables', () => {
      const theme = {
        cardBg: '#1e293b',
        primary: '#3b82f6',
        secondary: '#64748b',
        accent: '#f59e0b',
        background: { from: '#0f172a', to: '#1e293b' }
      }
      const variables = generateContrastVariables(theme)

      expect(variables['--dropdown-text-secondary']).toBeDefined()
      expect(variables['--dropdown-border']).toBeDefined()
      expect(variables['--dropdown-hover']).toBeDefined()
    })
  })

  describe('contrastClasses', () => {
    it('defines all expected class mappings', () => {
      expect(contrastClasses.highContrast).toBe('text-(--text-high-contrast)')
      expect(contrastClasses.onPrimary).toBe('text-(--text-on-primary)')
      expect(contrastClasses.onSecondary).toBe('text-(--text-on-secondary)')
      expect(contrastClasses.onAccent).toBe('text-(--text-on-accent)')
      expect(contrastClasses.onBackground).toBe('text-(--text-on-bg)')
    })

    it('defines dropdown classes', () => {
      expect(contrastClasses.dropdownText).toBeDefined()
      expect(contrastClasses.dropdownBg).toBeDefined()
      expect(contrastClasses.dropdownHover).toBeDefined()
    })

    it('defines button classes', () => {
      expect(contrastClasses.btnTextPrimary).toBeDefined()
      expect(contrastClasses.btnTextSecondary).toBeDefined()
    })
  })
})
