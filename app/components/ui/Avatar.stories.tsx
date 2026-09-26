import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from '@tacticus/ui-kit'

const meta: Meta<typeof Avatar> = {
  title: 'UI/Data Display/Avatar',
  component: Avatar,
  args: {
    displayName: 'Eisenhorn V.'
  },
  parameters: {
    layout: 'centered'
  }
}

export default meta

type Story = StoryObj<typeof Avatar>

export const Default: Story = {}

export const WithGuildCode: Story = {
  args: {
    guildCode: 'DEMO'
  }
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar displayName="Severus" size="sm" />
      <Avatar displayName="Severus" size="md" />
      <Avatar displayName="Severus" size="lg" />
    </div>
  )
}
