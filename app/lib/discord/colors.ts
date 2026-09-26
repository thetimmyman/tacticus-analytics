// Two palettes deliberately disagree on success/info/warning; merging changes embed colors.

export const EMBED_COLORS = {
  success: 0x22c55e,
  warning: 0xf59e0b,
  error: 0xef4444,
  info: 0x3b82f6,
  premium: 0x8b5cf6,
  gold: 0xffd700
}

// `as const`: consumers rely on literal types.
export const COLOR_PALETTE = {
  info: 0x5865f2,
  success: 0x3ba55d,
  warning: 0xf1c40f,
  danger: 0xed4245
} as const
