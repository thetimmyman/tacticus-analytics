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

### Status fills and hover

A filled danger or warning control reads the colour the theme paints
(`--danger`, `--warning`; Light Mode paints darker ones) and takes its label from
`--on-danger` or `--on-warning`. `applyThemeToCSS` sets them with the other
on-fill tokens; the first-paint script and the public wrapper's own token lists
leave them out, and the stylesheet carries dark defaults.

Hover is a step away from the label colour, not a translucent tint. A tint moves
toward whatever sits behind it, which lowered the label's contrast on hover.
`--danger-fill-hover`, `--warning-fill-hover` and `--accent-fill-hover` take a
20% step of the fill toward black or white, whichever direction stays readable
and moves the fill further. The label keeps at least 4.5:1, and at least
min(its rest contrast, 6:1), so hover is never the weaker state. A fill already
at one end (a white accent under a black label) can only step the other way.
Pair them as `bg-(--danger) text-(--on-danger) hover:bg-(--danger-fill-hover)`.

The shared confirm dialog uses this for all three tones. Its title is set in the
page text colour at 20px bold (WCAG large text, 3:1): a title in the status
colour fell under 4.5:1 on brighter card surfaces. Warning and danger put a round
badge in the status fill before the title, so the tone is not carried by colour
in the title text alone.

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

## Hover swaps are single-frame

A control whose label token and fill token both change on hover (`btn-wh40k`,
the creators website link, the reset-password submit) must not fade them. The
app-wide `html * { transition: color .3s, background-color .3s }` rule fades
both toward opposite ends, and the label and fill meet at about 1:1 half-way
(33 of 62 themes for primary to accent, 23 for primary to secondary). Such
controls opt out with `no-transition`, whose `!important` beats that rule;
`btn-wh40k` declares it for itself and its children. A control that keeps one
label across both fills may fade. `hover-label-swap.test.ts` rejects a file that
writes `hover:text-on-*` without a `no-transition` class token.

## Compliance and Verification Gates

```sh
npm test -- tests/unit/theme/on-fill-text.test.ts tests/unit/theme/on-fill-source-guard.test.ts tests/unit/theme/cta-gradient.test.ts tests/unit/theme/status-fill-text.test.ts tests/unit/theme/hover-label-swap.test.ts tests/components/ConfirmDialogTones.test.tsx
```

The first test checks all three tokens against 4.5:1 for every theme after
`applyThemeToCSS`. The second parses the source and the stylesheet and rejects a
filled control paired with a fixed or surface-token label. The third checks the
gradient label along the whole path for every theme. Measure computed
colours in the browser for each changed control across the theme list, including
the hover state, once the transition has settled.
