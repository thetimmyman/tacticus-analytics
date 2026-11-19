# ADR 0003: Label Colour Tokens for Filled Controls

## Status

Accepted

## Context and Problem Statement

Buttons, badges, active tabs and pills fill with the theme's primary, secondary or
accent colour. Their labels were fixed black, white or the page background, so
the pair only held 4.5:1 on some of the 62 themes. Measured in the browser, the
primary button label failed on 35 themes and the pager's current-page pill on 27.

## Decision

The theme runtime derives one label colour per fill and exposes it as
`--on-primary`, `--on-secondary` and `--on-accent`. Each is opaque `#000000` or
`#ffffff`, whichever has the higher contrast against the fill, so the result is
at least 4.5:1 for every theme. `applyThemeToCSS`, the first-paint script and
the public theme wrapper all set them, and the stylesheet defaults them for
pages that load before a theme.

Use the `text-on-primary-wh40k`, `text-on-secondary-wh40k` and
`text-on-accent-wh40k` utilities on any element whose background is the matching
`bg-*-wh40k` fill. Do not pair a fill with `text-white`, `text-black` or a
surface token. `--on-accent` follows the painted accent, which a theme's
semantic overrides can change, so pair it with `bg-accent-wh40k`, not with
`--accent-primary`.

`btn-wh40k` swaps its label through a `--btn-label` variable on hover instead of
setting `color`, so a button with its own `text-*` utility keeps that label.

## Consequences

A new theme needs no label tuning. Fixed-colour buttons such as destructive red
keep their own label and say so with an explicit class. Gradient controls that
run from primary to accent have no single fill to derive from; they are listed
in the source guard and counted per file, and a new one fails the guard until it
is reviewed.

## Compliance and Verification Gates

```sh
npm test -- tests/unit/theme/on-fill-text.test.ts tests/unit/theme/on-fill-source-guard.test.ts
```

The first test checks all three tokens against 4.5:1 for every theme after
`applyThemeToCSS`. The second parses the source and the stylesheet and rejects a
filled control paired with a fixed or surface-token label. Measure computed
colours in the browser for each changed control across the theme list, including
the hover state, once the transition has settled.
