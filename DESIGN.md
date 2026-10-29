---
version: alpha
name: Tacticus Analytics
description: Compact guild analytics with theme-aware surfaces and readable comparison data.
colors:
  primary: '#60a5fa'
  light-primary: '#1d4ed8'
  dark-background: '#0f172a'
  dark-text: '#f3f4f6'
  light-background: '#ffffff'
  light-text: '#0f172a'
typography:
  sans:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif'
  mono:
    fontFamily: 'ui-monospace, monospace'
rounded:
  DEFAULT: '0.5rem'
  md: '0.375rem'
spacing:
  phone-navigation: '4rem'
  card-padding: '0.75rem'
components:
  card:
    rounded: '{rounded.DEFAULT}'
    padding: '{spacing.card-padding}'
  phone-navigation:
    height: '{spacing.phone-navigation}'
    textColor: '{colors.primary}'
  phone-navigation-light:
    textColor: '{colors.light-primary}'
  action:
    height: '44px'
  page-dark:
    backgroundColor: '{colors.dark-background}'
    textColor: '{colors.dark-text}'
  page-light:
    backgroundColor: '{colors.light-background}'
    textColor: '{colors.light-text}'
---

# Tacticus Analytics Design System

## Overview

### Creative North Star

A guild operations desk: recognizable game imagery and a restrained theme accent
surround clear names, counts and comparisons. The data carries the emphasis.
Phone layouts make each report usable during play without turning every number
into a large dashboard tile.

### Product context and register

The product serves players comparing raid, roster and guild-war information, as
described in [README.md](README.md). It is a product interface with English
control labels. User-supplied names may contain other scripts and must remain
readable. This change introduces no new language or market-specific workflow.

Keep the existing theme system, game imagery, Lucide icons and compact utility
type. Avoid a marketing hero, decorative statistics, a second navigation taxonomy
or a new palette for phone screens.

Runtime tokens are authoritative. This document records their use; it does not
generate a competing token set. `app/globals.css` supplies fallbacks and
`app/lib/theme-system.ts` and `app/lib/themes/definitions/special-themes.ts`
supply user-selected themes. Theme changes must not
change the meaning of a status or permission.

## Colors

The frontmatter records default dark and light values. Shared surfaces use
`--card-bg`, `--card-border`, `--dropdown-bg-solid`, `--text-primary`,
`--text-secondary`, `--primary` and `--hover-bg`, allowing the selected theme to
override them. Phone chrome uses the solid dropdown surface so inactive labels
remain readable in both light and dark themes.

Color reinforces text and icons. It never supplies the only status, sort
direction, selected destination or failure indication. Focus uses the theme's
primary accent. Forced-color mode keeps system-operable scrollbars.

## Typography

Use the existing Inter/system sans stack for content and controls. Existing
monospace branding and numeric utility treatments remain available through the
shared utilities. Phone presentation reduces padding before reducing body text.
Small navigation labels remain at the existing utility scale, with complete
workspace labels; report titles wrap rather than being ellipsized.

## Layout

The shared `lg` breakpoint separates phone chrome from desktop chrome. Phone
navigation exposes at most five configured workspaces and leaves every other
visible destination in the account/navigation menu. Both read the same filtered
workspace definitions.

`--mobile-navigation-height` owns the 4rem navigation row, including its border.
Its height accommodates complete labels without shrinking the text. Content bottom reserve
and a sticky page-action bar reference that same token and add the safe-area
inset. A phone viewport must not place the last record or an action underneath
the navigation bar. Desktop pages keep their existing document scrolling.

Use cards where a report is read one record at a time. Preserve labelled,
contained horizontal tables for numeric matrices that require comparison. A
responsive representation retains the same ordering, actions and observed state.

## Elevation & Depth

Use the existing card border and surface hierarchy. Static records do not gain
decorative elevation. Menus and dialogs retain their existing overlay owners;
phone navigation and page actions remain below modal interaction layers.

## Shapes

Keep the existing rounded card and control families. Compact spacing must not
reduce an action's touch area below its shared 44px minimum. The phone navigation
row is 64px high before the safe-area inset.

## Components

| Concern                            | Runtime owner                                                      |
| ---------------------------------- | ------------------------------------------------------------------ |
| Theme values and global scrollbars | `app/globals.css`, `app/lib/theme-system.ts`                       |
| Workspace visibility               | `app/components/navigation/account-navigation.ts`, `workspaces.ts` |
| Phone chrome                       | `MobileNav`, `MobileTabBar`                                        |
| Record cards and page actions      | `MobileCardList`, `MobileActionBar`                                |
| Sorting and responsive table rows  | `packages/ui-kit/src/DataTable.tsx`                                |
| Filter disclosure                  | `app/components/ui/FilterBar.tsx`                                  |
| Dialog confirmation                | Existing shared `ConfirmDialog` and page action owner              |

The finite sort-column picker uses a native select: operating-system-owned popup
geometry and keyboard interaction are intentional. It cannot offer a sort-reset
operation that the shared sort contract does not support.

## Do's and Don'ts

- Keep complete record titles, known states and reachable controls.
- Preserve source ownership and distinguish unavailable data from an observed zero.
- Reuse current render callbacks; responsive presentation does not authorize an action.
- Use the existing native dialog and confirmation owner for deliberate actions.
- Keep wide tables contained and make sideways scrolling discoverable.
- Verify light and dark themes, narrow widths, keyboard input and the last record.
- Follow [UX-CONTRACT.md](UX-CONTRACT.md) for the phone presentation contract.
