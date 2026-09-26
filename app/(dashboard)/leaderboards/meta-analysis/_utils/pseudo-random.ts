/** Deterministic sine-hash PRNG, so particle positions stay stable across renders. */
export const getPseudoRandom = (
  seed: number,
  multiplier: number = 1
): number => {
  const x = Math.sin(seed * 12.9898) * 43758.5453123
  return (x - Math.floor(x)) * multiplier
}
