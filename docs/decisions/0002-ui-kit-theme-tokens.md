# ADR 0002: Theme Tokens for Shared UI Kit Primitives

## Status

Accepted

## Context and Problem Statement

Tacticus Analytics supplies its own theme variables and Tailwind utilities. Shared
primitives inherited shadcn classes such as `bg-background` and
`ring-offset-background`, which emitted no declarations in the app stylesheet.
The Radix switch thumb became transparent and the status badge variants lost
their visual distinction. [Shared primitive fix](https://github.com/thetimmyman/tacticus-analytics/pull/135)

## Decision

Bind shared primitives to the variables and utilities defined by the app theme.
Use the existing semantic tokens for surfaces, text and status. The stylesheet
defines CSS defaults and utility bindings, and the theme runtime applies overrides.
[`app/globals.css`](../../app/globals.css), [`app/lib/theme-system.ts`](../../app/lib/theme-system.ts)

| Primitive and state                    | Token bindings                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Radix switch, checked                  | `bg-accent-wh40k` (`--accent`) track, `--bg-primary` thumb                                                                                         |
| Radix switch, unchecked                | `--card-border` track, `--text-secondary` outline and thumb                                                                                        |
| Radix switch, keyboard focus           | `--accent` ring, `--bg-primary` offset                                                                                                             |
| Badge, default                         | `--card-border` outline, `text-primary-wh40k` (`--text-primary`) label                                                                             |
| Badge, secondary                       | `--card-border` outline, `--bg-secondary` fill, `text-secondary-wh40k` (`--text-secondary`) label                                                  |
| Badge, success, warning or destructive | Matching `--success-bg`/`--success-border`, `--warning-bg`/`--warning-border`, or `--error-bg`/`--error-border`, with a `text-primary-wh40k` label |

The switch thumb position and accessible checked state communicate on and off.
Badge text names the status so the tint is supplementary. This follows
[WCAG 2.2 Use of Color (1.4.1)](https://www.w3.org/TR/WCAG22/#use-of-color).

## Consequences

Shared primitives inherit the active theme's palette through a single token
contract. Adding a parallel set of shadcn aliases would introduce a second
mapping to maintain across the default stylesheet and runtime themes. A theme
override or a badge's consumer-supplied color classes can change the resolved
foreground and background, so verify the actual rendered pair after changes.

## Compliance and Verification Gates

Run the compiled stylesheet guard from the repository root.

```sh
npm test -- tests/unit/config/ui-kit-utilities.test.tsx
```

The guard compiles the real stylesheet against classes rendered by the
primitives. It checks both switch states, the unchecked track outline and focus
offset, all five distinct badge variants, and the card utilities. It also scans
the UI kit source for the unsupported shadcn utility family.
[`tests/unit/config/ui-kit-utilities.test.tsx`](../../tests/unit/config/ui-kit-utilities.test.tsx)

For changes to these bindings or their palette values, check the rendered
primitives in default dark, default light and every affected theme override.
Use the sign-in Remember me switch and the War Room readiness badges as examples.
Use a synthetic fixture for variants those screens do not render.
Tab to the switch and press Space to confirm a visible focus ring, visible thumb
in both positions and a matching accessible checked state. Check each badge
variant on its actual surface. Composite any translucent fill over that surface
before measuring the label contrast.

Require at least 4.5:1 for normal-size badge text against its rendered background
and at least 3:1 against adjacent colors for the visual information needed to
identify the switch and its states, including the focus indicator. The compiled
stylesheet guard verifies declarations. Measure those ratios in the browser using
the computed colors for each checked theme and state.
[WCAG 2.2 Minimum Contrast (1.4.3)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
and [Non-text Contrast (1.4.11)](https://www.w3.org/TR/WCAG22/#non-text-contrast).
