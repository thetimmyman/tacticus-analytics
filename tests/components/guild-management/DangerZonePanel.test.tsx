import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DangerZonePanel } from '@/app/(dashboard)/guild-management/settings/DangerZonePanel'

vi.mock('@tacticus/ui-kit', () => ({
  Button: ({
    children,
    loading,
    loadingText,
    ...props
  }: {
    children: ReactNode
    loading?: boolean
    loadingText?: string
    [key: string]: unknown
  }) => (
    <button {...props}>
      {loading && loadingText ? loadingText : children}
    </button>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
  Switch: ({
    checked,
    disabled,
    onCheckedChange
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange: (value: boolean) => void
  }) => (
    <input
      aria-label="Enable guild analytics"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
      type="checkbox"
    />
  )
}))

vi.mock('@/app/(dashboard)/guild-management/settings/SettingsSection', () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  )
}))

vi.mock('@/app/lib/hooks/useGuildDisplayLabel', () => ({
  useGuildDisplayLabel: () => 'Example Alliance'
}))

describe('DangerZonePanel', () => {
  it('enables deletion only after typing the displayed guild name', () => {
    const onDeleteGuild = vi.fn()

    render(
      <DangerZonePanel
        guildCode="EOT"
        enabled
        onEnabledChange={vi.fn()}
        saving={false}
        deleting={false}
        canModifyStatus
        canDeleteGuild
        onDeleteGuild={onDeleteGuild}
      />
    )

    const deleteButton = screen.getByRole('button', {
      name: /delete guild & all data/i
    })
    expect(deleteButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type the guild name/i), {
      target: { value: 'Example Alliance' }
    })

    expect(deleteButton).not.toBeDisabled()
    fireEvent.click(deleteButton)
    expect(onDeleteGuild).toHaveBeenCalledTimes(1)
  })

  it('explains that guild deletion is restricted to app admins', () => {
    render(
      <DangerZonePanel
        guildCode="EOT"
        enabled
        onEnabledChange={vi.fn()}
        saving={false}
        deleting={false}
        canModifyStatus
        canDeleteGuild={false}
        onDeleteGuild={vi.fn()}
      />
    )

    expect(
      screen.getByText('Only app admins can authorize data deletion.')
    ).toBeInTheDocument()
  })
})
