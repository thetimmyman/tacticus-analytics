# Phone presentation contract

This contract covers the responsive navigation, filters and record presentations.
Existing page services, authorization, data collection and mutation rules remain
with their owners. [DESIGN.md](DESIGN.md) records visual conventions.

## Source and behavior ownership

Workspace visibility comes from `account-navigation.ts` and `workspaces.ts`.
Role, profile, cluster and release-stage filtering precede both phone navigation
representations. A bottom tab is not an additional permission or a second route
registry. Page action callbacks retain the existing server authorization and
confirmation paths.

## Canonical UI Map

| Capability      | Canonical owner                          | Source of truth                        | Allowed variants                                | Verification                              |
| --------------- | ---------------------------------------- | -------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| Select/Listbox  | Existing native finite-option selects    | Caller-owned options and sort contract | Native operating-system popup                   | Keyboard selection and sort parity        |
| Table Selection | Existing caller-owned selection controls | Page data/action owner                 | Existing page scope only; no new bulk selection | Existing selection and confirmation tests |
| Scrollbar       | Global application stylesheet            | Theme surface and accent variables     | Contained wide-table scrolling                  | Native overflow and computed styles       |

Native selects retain the operating system popup, keyboard behavior and touch
interaction for finite options, including season, report filters and the table
sort column. The caller supplies valid options and handles changes; a placeholder
that cannot reset sorting is disabled. Searchable entity selection and date
controls keep their existing owners and are outside this change.

## State and ordering

- Both table and card presentations use the same resolved rows and sort state.
- Externally sorted or paginated rows retain the caller's order when requested.
- The caller owns dataset navigation and result counts. A responsive view does
  not turn a page of results into a claim about the entire dataset.
- Loading, empty, unavailable and missing observations keep their existing
  meanings. Card metadata is supplied by the page; the primitive invents none.
- Automatic cards use a real first column as their title. A caller with no table
  columns supplies an explicit card renderer instead.

## Navigation and actions

- Bottom tabs carry the current season like the existing menu links.
- The current workspace has a text label and `aria-current` state.
- An unavailable destination is removed by the shared visibility owner.
- A linked card does not nest action controls inside its link.
- Page actions and destructive confirmations stay with their existing owners.
- Changing the phone representation must not lose a detail link or callback.

## Filters

The shared filter bar owns only presentation and secondary-filter disclosure.
Its search, primary filters, counts and reset behavior are supplied by the page.
Existing query ownership and server-side scope remain unchanged. Disclosure uses
a real button, visible focus and an accurate expanded state.

## Responsive verification

Verify representative record cards, a comparison table, filter disclosure and
page actions at narrow phone widths and a desktop width. Exercise keyboard
sorting, navigation targets, long titles, empty/unavailable states and both
supported theme modes with synthetic data. Native component fixtures qualify
the changed layout families; they do not claim a new backend or device capability.
