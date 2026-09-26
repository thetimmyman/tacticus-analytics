// @ts-nocheck
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ClientDate } from '@tacticus/ui-kit'

const meta: Meta<typeof ClientDate> = {
  title: 'UI/Data Display/Client Date',
  component: ClientDate,
  args: {
    date: new Date('2025-03-15T13:45:00Z').toISOString(),
    className: 'font-mono text-sm'
  },
  parameters: {
    layout: 'centered'
  }
}

export default meta

type Story = StoryObj<typeof ClientDate>

export const Smart: Story = {
  args: {
    format: 'smart'
  }
}

export const Relative: Story = {
  args: {
    format: 'relative'
  }
}

export const BattleClock: Story = {
  args: {
    format: 'battle'
  }
}

export const TooltipDisabled: Story = {
  args: {
    format: 'full',
    title: false
  }
}
