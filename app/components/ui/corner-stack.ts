/**
 * Single source of truth for the fixed bottom-right stack (SYS chip, OperationalStatusPill
 * above it). Change geometry here only; classes stay static strings for Tailwind's scanner.
 */

export const CORNER_STACK_SYNC_SLOT_CLASS =
  'fixed bottom-[calc(var(--mobile-navigation-offset)_+_1rem)] right-[calc(1rem_+_env(safe-area-inset-right))] z-40'

export const CORNER_STACK_PILL_SLOT_CLASS =
  'fixed bottom-[calc(var(--mobile-navigation-offset)_+_4rem)] right-[calc(1rem_+_env(safe-area-inset-right))] z-40'

/** Below sm: lift above the stack (bottom-28 = 112px clears the ~94px pill). */
export const CORNER_STACK_MOBILE_CLEARANCE_CLASS =
  'bottom-[calc(var(--mobile-navigation-offset)_+_7rem)]'

export const CORNER_STACK_INLINE_CLEARANCE_CLASS =
  'sm:bottom-[calc(var(--mobile-navigation-offset)_+_1rem)]'

export const CORNER_STACK_ROOMY_INLINE_CLEARANCE_CLASS =
  'sm:bottom-[calc(var(--mobile-navigation-offset)_+_1.5rem)]'

/** sm+: reserve a 144px right gutter (apply to a wrapper). */
export const CORNER_STACK_RIGHT_GUTTER_CLASS = 'sm:pr-36'
