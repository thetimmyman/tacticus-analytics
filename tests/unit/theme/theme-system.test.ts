import { beforeEach, describe, expect, it } from 'vitest'
import { applyThemeToCSS, type GuildTheme } from '@/app/lib/theme-system'

const baseTheme: GuildTheme = {
  name: 'Test Theme',
  primary: '#111111',
  secondary: '#222222',
  accent: '#333333',
  background: {
    from: '#000000',
    via: '#111111',
    to: '#000000'
  },
  cardBg: 'rgba(17, 17, 17, 0.8)',
  cardBorder: 'rgba(255, 255, 255, 0.2)',
  text: {
    primary: '#eeeeee',
    secondary: '#bbbbbb',
    accent: '#999999'
  }
}

describe('applyThemeToCSS semantic tokens', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('writes the default semantic tokens', () => {
    applyThemeToCSS(baseTheme)

    const style = document.documentElement.style
    expect(style.getPropertyValue('--info')).toBe('#0ea5e9')
    expect(style.getPropertyValue('--info-bg')).toBe('rgba(14, 165, 233, 0.2)')
    expect(style.getPropertyValue('--info-border')).toBe(
      'rgba(14, 165, 233, 0.3)'
    )
    expect(style.getPropertyValue('--danger')).toBe('#ff6b6b')
    expect(style.getPropertyValue('--error')).toBe('#ff6b6b')
  })

  it('applies light-theme semantic overrides after the light defaults', () => {
    applyThemeToCSS({
      ...baseTheme,
      background: {
        from: '#ffffff',
        via: '#ffffff',
        to: '#ffffff'
      },
      cardBg: 'rgba(255, 255, 255, 0.9)',
      semanticOverrides: {
        warning: '#a16207',
        success: '#15803d',
        danger: '#b91c1c',
        info: '#0369a1'
      }
    })

    const style = document.documentElement.style
    expect(style.getPropertyValue('--warning')).toBe('#a16207')
    expect(style.getPropertyValue('--success')).toBe('#15803d')
    expect(style.getPropertyValue('--danger')).toBe('#b91c1c')
    expect(style.getPropertyValue('--info')).toBe('#0369a1')
  })

  it('applies accent semantic overrides to accent and text-accent vars', () => {
    applyThemeToCSS({
      ...baseTheme,
      semanticOverrides: {
        accent: '#ffffff'
      }
    })

    const style = document.documentElement.style
    expect(style.getPropertyValue('--accent')).toBe('#ffffff')
    expect(style.getPropertyValue('--text-accent')).toBe('#ffffff')
  })
})
