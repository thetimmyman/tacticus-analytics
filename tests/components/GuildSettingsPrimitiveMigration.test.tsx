import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PrivacySettingsPanel } from '@/app/(dashboard)/guild-management/settings/PrivacySettingsPanel'

describe('Guild settings primitive migration', () => {
  it('keeps obfuscation slider changes separate from privacy mode toggles', () => {
    const onExplorePrivacyModeChange = vi.fn()
    const onObfuscationPercentChange = vi.fn()

    render(
      <PrivacySettingsPanel
        explorePrivacyMode={['obfuscate_values']}
        onExplorePrivacyModeChange={onExplorePrivacyModeChange}
        obfuscationPercent={12}
        onObfuscationPercentChange={onObfuscationPercentChange}
      />
    )

    fireEvent.keyDown(
      screen.getByRole('slider', { name: /obfuscation percent/i }),
      { key: 'ArrowRight' }
    )

    expect(onObfuscationPercentChange).toHaveBeenCalledWith(15)
    expect(onExplorePrivacyModeChange).not.toHaveBeenCalled()
  })

  it('passes disabled state into the custom privacy slider', () => {
    render(
      <PrivacySettingsPanel
        explorePrivacyMode={['obfuscate_values']}
        onExplorePrivacyModeChange={() => {}}
        obfuscationPercent={10}
        onObfuscationPercentChange={() => {}}
        disabled
      />
    )

    const slider = screen.getByRole('slider', { name: /obfuscation percent/i })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveAttribute('tabindex', '-1')
  })
})
