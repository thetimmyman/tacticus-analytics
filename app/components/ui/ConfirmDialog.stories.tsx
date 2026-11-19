import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Visual qualification fixtures for the shared confirmation dialog in each
 * tone. It reads the theme's own tokens, so render it in every theme. Names
 * and values are invented. The preview wraps stories in the public theme
 * wrapper, which re-declares accent and text colours without the theme's
 * overrides; the signed-in app does not, so clear that wrapper's inline style
 * before measuring a theme that has overrides.
 */
const meta: Meta<typeof ConfirmDialog> = {
  title: 'UI/Confirm dialog',
  component: ConfirmDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    title: 'Remove example key?',
    description: 'Anything still using this example key will stop working.',
    confirmLabel: 'Remove key',
    cancelLabel: 'Keep key',
    onCancel: () => {},
    onConfirm: () => {}
  }
}

export default meta

type Story = StoryObj<typeof ConfirmDialog>

export const Default: Story = { args: { tone: 'default' } }
export const Warning: Story = { args: { tone: 'warning' } }
export const Danger: Story = { args: { tone: 'danger' } }
export const DangerBusy: Story = { args: { tone: 'danger', busy: true } }
