import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(dashboard)/guild-management/settings/SettingsSection', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  )
}))

vi.mock('@/app/lib/hooks/useGuildDisplayLabel', () => ({
  useGuildDisplayLabel: () => 'Example Alliance'
}))

import { DangerZonePanel } from '@/app/(dashboard)/guild-management/settings/DangerZonePanel'
import { getContrastRatio } from '@/app/lib/utils/contrast'

/**
 * Both danger cards paint opaque dark-red/black surfaces and opt into
 * `scheme-dark`: the palette red tiers resolve light under color-scheme
 * dark instead of landing dark-on-dark on Light Mode (2.08:1 before).
 */

const tokensOf = (el: Element) =>
  (el.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean)

const hexToRgb = (hex: string): number[] =>
  [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16))

const blend = (foreground: string, background: string, alpha: number) => {
  const front = hexToRgb(foreground)
  const back = hexToRgb(background)
  const mixed = front.map((channel, i) =>
    Math.round(alpha * channel + (1 - alpha) * back[i]!)
  )
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const baseProps = {
  guildCode: 'EOT',
  enabled: true,
  onEnabledChange: vi.fn(),
  saving: false,
  deleting: false,
  canModifyStatus: true,
  canDeleteGuild: true,
  onDeleteGuild: vi.fn()
}

describe('DangerZonePanel: a readable danger island on every page theme', () => {
  it('paints both danger cards as opaque scheme-dark islands', () => {
    const { container } = render(<DangerZonePanel {...baseProps} />)

    const panels = [...container.querySelectorAll('.scheme-dark')]
    expect(panels).toHaveLength(2)
    expect(tokensOf(panels[0]!)).toContain('bg-red-950')
    expect(tokensOf(panels[1]!)).toContain('bg-black')
    expect(panels[0]!.textContent).toContain('Disable guild analytics')
    expect(panels[1]!.textContent).toContain('Delete guild records')

    // No translucent paint survives inside the islands: alpha would let the
    // Light Mode page bleed through and drop the red tiers below AA.
    for (const panel of panels) {
      for (const el of [panel, ...panel.querySelectorAll('*')]) {
        expect(
          tokensOf(el).filter((token) => /^bg-\S+\/\d+$/u.test(token)),
          (el as HTMLElement).className
        ).toEqual([])
      }
    }
  })

  it('keeps every red label inside a scheme-dark island at AA', () => {
    const { container } = render(<DangerZonePanel {...baseProps} />)

    const redLabels = [...container.querySelectorAll('[class*="text-red-"]')]
    expect(redLabels.length).toBeGreaterThan(3)
    for (const el of redLabels) {
      expect(el.closest('.scheme-dark')).not.toBeNull()
    }

    expect(getContrastRatio('#fee2e2', '#450a0a')).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio('#fecaca', '#450a0a')).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio('#fda4af', '#450a0a')).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio('#fef2f2', '#b91c1c')).toBeGreaterThanOrEqual(4.5)
    // The 80% body tier blended over the opaque base still clears AA.
    expect(
      getContrastRatio(blend('#fecaca', '#450a0a', 0.8), '#450a0a')
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('names the analytics switch after its heading', () => {
    render(<DangerZonePanel {...baseProps} enabled />)

    const toggle = screen.getByRole('switch', {
      name: 'Disable guild analytics'
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle.id).toBe('disable-guild-analytics-switch')
    expect(toggle.getAttribute('aria-labelledby')).toBe(
      'disable-guild-analytics-title'
    )
    expect(screen.getByText('Disable guild analytics').id).toBe(
      'disable-guild-analytics-title'
    )
  })

  it('toggles analytics from the labelled switch', () => {
    const onEnabledChange = vi.fn()
    render(
      <DangerZonePanel
        {...baseProps}
        enabled={false}
        onEnabledChange={onEnabledChange}
      />
    )

    fireEvent.click(
      screen.getByRole('switch', { name: 'Disable guild analytics' })
    )
    expect(onEnabledChange).toHaveBeenCalledWith(true)
  })
})
