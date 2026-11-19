import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Badge, type BadgeVariant } from '@tacticus/ui-kit'
import { RadixSwitch } from '../../../packages/ui-kit/src/radix-switch'

/**
 * Visual qualification fixtures for the shared switch and badge. Both read the
 * theme's own tokens, so they are rendered in each supported theme. Names and
 * values are invented.
 */

const meta: Meta = {
  title: 'UI/Status/Primitives',
  parameters: { layout: 'fullscreen' }
}

export default meta

type Story = StoryObj

const readiness: Array<{ name: string; label: string; variant: BadgeVariant }> =
  [
    { name: 'Example Squad Alpha', label: 'ready', variant: 'success' },
    { name: 'Example Squad Beta', label: 'used', variant: 'secondary' },
    { name: 'Example Squad Gamma', label: 'not ready', variant: 'destructive' }
  ]

const variants: BadgeVariant[] = [
  'default',
  'secondary',
  'success',
  'warning',
  'destructive'
]

function SwitchRow({
  id,
  label,
  checked: initial,
  disabled
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
}) {
  const [checked, setChecked] = useState(initial)
  return (
    <div className="flex items-center gap-2">
      <RadixSwitch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={setChecked}
      />
      <label htmlFor={id} className="text-sm text-secondary-wh40k">
        {label}
      </label>
    </div>
  )
}

export const All: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] space-y-6 p-4">
      <section aria-labelledby="switch-heading" className="space-y-3">
        <h2 id="switch-heading" className="text-base font-semibold">
          Switch
        </h2>
        <SwitchRow id="example-on" label="Remember me (on)" checked />
        <SwitchRow id="example-off" label="Remember me (off)" checked={false} />
        <SwitchRow
          id="example-disabled"
          label="Unavailable setting"
          checked
          disabled
        />
      </section>
      <section aria-labelledby="badge-heading" className="space-y-3">
        <h2 id="badge-heading" className="text-base font-semibold">
          Badge variants
        </h2>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      </section>
      <section aria-labelledby="readiness-heading" className="space-y-3">
        <h2 id="readiness-heading" className="text-base font-semibold">
          Team readiness
        </h2>
        <ul className="space-y-2">
          {readiness.map((team) => (
            <li
              key={team.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-(--card-border) bg-(--card-bg) p-3 text-sm"
            >
              <span>{team.name}</span>
              <Badge variant={team.variant}>{team.label}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
