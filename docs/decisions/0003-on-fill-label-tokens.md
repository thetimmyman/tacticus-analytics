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

### Gradient call-to-actions

A control that fades from the primary to the accent has no single fill, and for
33 of the 62 themes no one label reads on both ends (a dark primary against a
light accent). The runtime therefore also sets `--cta-from`, `--cta-to` and
`--on-cta`. It keeps whichever of the two theme colours needs the smaller
change, pulls the other toward it only until the label reaches 4.6:1 on every
colour of the sRGB line between the stops, and falls back to a flat fill when
the two colours are the same. A red-to-gold theme stays red-to-gold, the red
moving a few percent.

Paint these with
`bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-on-cta-wh40k`. The
`/srgb` modifier is required: the label was chosen on that path, and Tailwind's
default interpolation (oklab) passes through different colours. Where the
element is a link, add `hover:filter-none` so the global anchor brightening does
not lighten the fill under a white label, and use a hover cue that does not
depend on the gradient (a flat theme has none to flip).

## Consequences

A new theme needs no label tuning. Fixed-colour buttons such as destructive red
keep their own label and say so with an explicit class. The source guard
rejects a class string that pairs raw `--primary`/`--accent` stops with any text
colour, a `--cta-*` gradient with any label but `--on-cta`, and a `--cta-*`
gradient not painted in sRGB at every width. It reads one class string at a
time, so a label on a child element, a class chosen from a lookup table or an
inline style is not checked; measure those in the browser. For themes whose
colours sit far apart (a navy primary with a gold accent) the dark end of the
gradient is lightened noticeably, because gold cannot carry a white label.

## Compliance and Verification Gates

```sh
npm test -- tests/unit/theme/on-fill-text.test.ts tests/unit/theme/on-fill-source-guard.test.ts tests/unit/theme/cta-gradient.test.ts
```

The first test checks all three tokens against 4.5:1 for every theme after
`applyThemeToCSS`. The second parses the source and the stylesheet and rejects a
filled control paired with a fixed or surface-token label. The third checks the
gradient label along the whole path for every theme. Measure computed
colours in the browser for each changed control across the theme list, including
the hover state, once the transition has settled.
