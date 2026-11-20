import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * Visual qualification fixture for the status and accent text tiers. The
 * 200-400 tiers resolve against the page's color-scheme (see the palette
 * block in globals.css): dark themes keep Tailwind's values, the light theme
 * gets dark tiers that clear 4.5:1, and a surface that stays dark inside a
 * light page opts back in with `scheme-dark`.
 */

const meta: Meta = {
  title: 'UI/Status palette',
  parameters: { layout: 'fullscreen' }
}

export default meta

type Story = StoryObj

// Class names are written out whole so the Tailwind scanner can see them.
const TEXT_TIERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['red', ['text-red-200', 'text-red-300', 'text-red-400']],
  ['green', ['text-green-200', 'text-green-300', 'text-green-400']],
  ['yellow', ['text-yellow-200', 'text-yellow-300', 'text-yellow-400']],
  ['amber', ['text-amber-200', 'text-amber-300', 'text-amber-400']],
  ['orange', ['text-orange-200', 'text-orange-300', 'text-orange-400']],
  ['emerald', ['text-emerald-200', 'text-emerald-300', 'text-emerald-400']],
  ['blue', ['text-blue-200', 'text-blue-300', 'text-blue-400']],
  ['sky', ['text-sky-200', 'text-sky-300', 'text-sky-400']],
  ['purple', ['text-purple-200', 'text-purple-300', 'text-purple-400']],
  ['cyan', ['text-cyan-200', 'text-cyan-300', 'text-cyan-400']]
]

const CHIPS: ReadonlyArray<readonly [string, string]> = [
  ['Ready', 'border-green-400/40 bg-green-500/15 text-green-400'],
  ['Used', 'border-yellow-400/40 bg-yellow-500/15 text-yellow-400'],
  ['Not ready', 'border-red-400/40 bg-red-500/15 text-red-400'],
  ['Estimated', 'border-amber-400/40 bg-amber-500/15 text-amber-300'],
  ['Syncing', 'border-blue-400/40 bg-blue-500/15 text-blue-400'],
  ['Severe', 'border-red-400/40 bg-red-900/30 text-red-300']
]

function TierGrid({
  labelClass = 'text-(--text-secondary)',
  headClass = 'text-(--text-muted)'
}: {
  labelClass?: string
  headClass?: string
}) {
  return (
    <div className="grid grid-cols-[5rem_repeat(3,minmax(0,1fr))] gap-x-4 gap-y-1 text-sm">
      <span />
      {['200', '300', '400'].map((tier) => (
        <span key={tier} className={`text-xs ${headClass}`}>
          {tier}
        </span>
      ))}
      {TEXT_TIERS.map(([hue, classes]) => (
        <div key={hue} className="contents">
          <span className={labelClass}>{hue}</span>
          {classes.map((className) => (
            <span key={className} className={className}>
              Sample text
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function ChipRow() {
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map(([label, className]) => (
        <span
          key={label}
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function Panel() {
  return (
    <div className="min-h-screen bg-(--bg-primary) text-(--text-primary)">
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-(--text-primary)">
            Text on the page surface
          </h2>
          <TierGrid />
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-(--text-primary)">
            Chips on a tinted surface
          </h2>
          <ChipRow />
        </section>
        <section
          data-testid="dark-island"
          className="scheme-dark space-y-3 rounded-lg border border-slate-600 bg-slate-900 p-4"
        >
          <h2 className="text-base font-semibold text-white">
            Surface that stays dark (scheme-dark)
          </h2>
          <TierGrid labelClass="text-slate-300" headClass="text-slate-400" />
          <ChipRow />
        </section>
      </div>
    </div>
  )
}

export const OnThemeSurface: Story = {
  render: () => <Panel />
}
