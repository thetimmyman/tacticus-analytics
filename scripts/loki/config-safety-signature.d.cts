// Type surface for the shared config safety guard (the .cjs holds the contract).
export function safetySignature(cfg: unknown): string
export function isSafeContentsRoll(oldCfg: unknown, newCfg: unknown): boolean
