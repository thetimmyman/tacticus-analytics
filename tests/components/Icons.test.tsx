import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import { AnalyticsIcon } from '@/app/components/icons/AnalyticsIcon'
import { GoogleSheetsIcon } from '@/app/components/icons/GoogleSheetsIcon'
import { TikTokIcon } from '@/app/components/icons/TikTokIcon'
import { YouTubeIcon } from '@/app/components/icons/YouTubeIcon'

const iconCases: Array<[string, ComponentType<{ className?: string }>]> = [
  ['DiscordIcon', DiscordIcon],
  ['GoogleSheetsIcon', GoogleSheetsIcon],
  ['TikTokIcon', TikTokIcon],
  ['YouTubeIcon', YouTubeIcon]
]

describe('icon components', () => {
  it.each(iconCases)('renders %s with className', (_name, Icon) => {
    const { container } = render(<Icon className="icon-class" />)
    const svg = container.querySelector('svg')

    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('class')).toContain('icon-class')
  })

  it('renders AnalyticsIcon as the decorative project mark with className', () => {
    const { container } = render(<AnalyticsIcon className="icon-class" />)
    const img = container.querySelector('img')

    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('/favicon.svg')
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
    expect(img?.getAttribute('class')).toContain('icon-class')
  })
})
