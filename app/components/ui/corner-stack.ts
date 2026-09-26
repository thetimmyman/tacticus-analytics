/**
 * Single source of truth for the fixed bottom-right stack (SYS chip, OperationalStatusPill
 * above it). Change geometry here only; classes stay static strings for Tailwind's scanner.
 */

export const CORNER_STACK_SYNC_SLOT_CLASS = 'fixed bottom-4 right-4 z-40'

export const CORNER_STACK_PILL_SLOT_CLASS = 'fixed bottom-16 right-4 z-40'

/** Below sm: lift above the stack (bottom-28 = 112px clears the ~94px pill). */
export const CORNER_STACK_MOBILE_CLEARANCE_CLASS = 'bottom-28'

/** sm+: reserve a 144px right gutter (apply to a wrapper). */
export const CORNER_STACK_RIGHT_GUTTER_CLASS = 'sm:pr-36'
